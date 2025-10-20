/**
 * Sync Network Job
 * Syncs Twitter network data (following, their posts) for a connected account
 */

import { ConnectedAccount, NetworkProfile, NetworkPost } from "#src/models/index.js";
import twitterService from "#src/services/twitter.js";
import rateLimiter from "#src/services/rate-limiter.js";
import { ghostQueue } from "#src/background/queues/index.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const JOB_SYNC_NETWORK = "sync-network";

/**
 * Extract topics from a batch of tweets using AI
 * Returns array of topic arrays, one per tweet
 */
async function extractTopicsFromBatch(tweets) {
  if (tweets.length === 0) return [];

  try {
    const prompt = `Extract 2-4 main topics from each of these social media posts. Topics should be specific concepts, projects, events, or themes being discussed (e.g., "DeFi protocol audits", "NFT airdrops", "Monad ecosystem").

Posts:
${tweets.map((t, i) => `${i + 1}. ${t.content}`).join('\n')}

Return ONLY a JSON object with a "topics" array where each element is an array of topic strings:
{"topics": [["topic1", "topic2"], ["topic3", "topic4"], ...]}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You extract topics from social media posts. Return only valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result.topics || [];
  } catch (error) {
    console.warn(`[Sync Network] Failed to extract topics with AI:`, error.message);
    // Fallback: return empty arrays for each tweet
    return tweets.map(() => []);
  }
}

export default async function syncNetwork(job) {
  const { connectedAccountId } = job.data;

  console.log(`[Sync Network] Starting sync for connected account: ${connectedAccountId}`);

  try {
    // Get connected account
    const connectedAccount = await ConnectedAccount.query().findById(connectedAccountId);

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
    }

    if (!connectedAccount.access_token) {
      throw new Error(`Connected account ${connectedAccountId} has no access token`);
    }

    // Mark as syncing
    await connectedAccount.markAsSyncing();

    // Decrypt the access token
    const access_token = connectedAccount.getDecryptedAccessToken();
    const { platform_user_id } = connectedAccount;

    if (!access_token) {
      throw new Error(`Failed to decrypt access token for account ${connectedAccountId}`);
    }

    // Check rate limit BEFORE making any API call
    console.log(`[Sync Network] Checking rate limit for timeline endpoint...`);
    const rateLimitCheck = await rateLimiter.checkRateLimit("timeline", platform_user_id);

    if (!rateLimitCheck.allowed) {
      const delayMs = rateLimitCheck.retryAfter * 1000;
      console.log(
        `[Sync Network] Rate limited! Scheduling delayed job in ${rateLimitCheck.retryAfter}s ` +
        `(at ${new Date(Date.now() + delayMs).toISOString()})`
      );

      // Schedule a delayed job with the same jobId (will replace this one)
      await ghostQueue.add(
        JOB_SYNC_NETWORK,
        { connectedAccountId },
        {
          jobId: `sync-network-${connectedAccountId}`,
          delay: delayMs,
        }
      );

      // Return success - no error, just rescheduled
      return {
        success: true,
        rescheduled: true,
        retryAfter: rateLimitCheck.retryAfter,
        message: `Job rescheduled due to rate limit. Will retry in ${rateLimitCheck.retryAfter}s`,
      };
    }

    console.log(`[Sync Network] Rate limit OK - proceeding with API call`);

    // Step 1: Fetch recent posts from timeline
    console.log(`[Sync Network] Fetching home timeline...`);
    const { tweets } = await twitterService.getHomeTimeline(access_token, platform_user_id, {
      maxResults: 10, // Conservative limit for Free tier (100 posts/month cap)
    });

    console.log(`[Sync Network] Found ${tweets.length} recent posts`);

    // Extract topics from all posts in one batch using AI
    console.log(`[Sync Network] Extracting topics with AI...`);
    const batchTopics = await extractTopicsFromBatch(tweets);
    console.log(`[Sync Network] Extracted topics for ${batchTopics.length} posts`);

    // Save posts and create/update author profiles on-demand
    let postsSynced = 0;
    let profilesCreated = 0;

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      try {
        // Create/update network profile for this author (on-demand from timeline)
        const authorProfile = await NetworkProfile.query()
          .insert({
            connected_account_id: connectedAccount.id,
            platform: connectedAccount.platform,
            platform_user_id: tweet.author_id,
            username: tweet.author_username,
            display_name: tweet.author_name || tweet.author_username,
            engagement_score: 0,
            relevance_score: 0,
            profile_data: {},
            last_synced_at: new Date().toISOString(),
          })
          .onConflict(["connected_account_id", "platform_user_id"])
          .merge([
            "username",
            "display_name",
            "last_synced_at",
          ])
          .returning("*")
          .first(); // Get single object instead of array

        profilesCreated++;

        // Use AI-extracted topics for this post
        const topics = batchTopics[i] || [];
        const sentiment = twitterService.analyzeSentiment(tweet.content);
        const engagementScore = twitterService.calculateEngagement({
          reply_count: tweet.reply_count,
          retweet_count: tweet.retweet_count,
          like_count: tweet.like_count,
          quote_count: tweet.quote_count,
        });

        await NetworkPost.query()
          .insert({
            connected_account_id: connectedAccount.id,
            network_profile_id: authorProfile.id,
            platform: connectedAccount.platform,
            post_id: tweet.post_id,
            content: tweet.content,
            posted_at: tweet.posted_at,
            reply_count: tweet.reply_count,
            retweet_count: tweet.retweet_count,
            like_count: tweet.like_count,
            quote_count: tweet.quote_count || 0,
            engagement_score: engagementScore,
            topics,
            sentiment,
          })
          .onConflict(["connected_account_id", "post_id"])
          .merge([
            "reply_count",
            "retweet_count",
            "like_count",
            "quote_count",
            "engagement_score",
            "topics", // Update topics on conflict
          ]);

        postsSynced++;
      } catch (error) {
        console.warn(`Failed to sync post ${tweet.post_id}:`, error.message);
      }
    }

    job.updateProgress(60);
    console.log(`[Sync Network] Synced ${postsSynced} posts from ${profilesCreated} authors`);

    // Step 2: Calculate engagement scores for network profiles
    console.log(`[Sync Network] Calculating engagement scores...`);
    const profiles = await NetworkProfile.query()
      .where("connected_account_id", connectedAccount.id);

    for (const profile of profiles) {
      const posts = await NetworkPost.query()
        .where("network_profile_id", profile.id)
        .where("posted_at", ">", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()); // Last 30 days

      if (posts.length > 0) {
        const avgEngagement = posts.reduce((sum, p) => sum + (p.engagement_score || 0), 0) / posts.length;

        // Ensure valid number (not NaN or Infinity)
        const validEngagement = Number.isFinite(avgEngagement) ? avgEngagement : 0;

        await profile.$query().patch({
          engagement_score: validEngagement,
          relevance_score: validEngagement, // Can be more sophisticated
        });
      }
    }

    job.updateProgress(95);

    // Mark as ready
    await connectedAccount.markAsReady();

    job.updateProgress(100);

    console.log(`[Sync Network] Sync completed successfully`);

    return {
      success: true,
      profiles_created: profilesCreated,
      posts_synced: postsSynced,
      completed_at: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[Sync Network] Error:`, error);

    // Mark connected account as error
    try {
      const connectedAccount = await ConnectedAccount.query().findById(connectedAccountId);
      if (connectedAccount) {
        await connectedAccount.markAsError(error.message);
      }
    } catch (updateError) {
      console.error("Failed to update connected account error status:", updateError);
    }

    throw error; // Re-throw to trigger job retry
  }
}
