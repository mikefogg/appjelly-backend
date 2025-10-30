/**
 * Sync Curated Topic Job
 * Syncs posts from a specific Twitter list for a curated topic
 */

import { CuratedTopic, NetworkPost } from "#src/models/index.js";
import { ghostQueue } from "#src/background/queues/index.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const JOB_SYNC_CURATED_TOPIC = "sync-curated-topic";
export const JOB_DIGEST_RECENT_TOPICS = "digest-recent-topics";

/**
 * Get tweets from a Twitter list
 * Twitter API v2 endpoint: GET /2/lists/:id/tweets
 */
async function getListTweets(listId, accessToken, options = {}) {
  const { maxResults = 100 } = options;

  const params = new URLSearchParams({
    "tweet.fields": "created_at,public_metrics,author_id",
    "user.fields": "username,name,profile_image_url",
    "expansions": "author_id",
    "max_results": maxResults.toString(),
  });

  const url = `https://api.twitter.com/2/lists/${listId}/tweets?${params}`;

  console.log(`[Sync Curated Topic] Fetching list tweets: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    console.error(`[Sync Curated Topic] Twitter API error:`, error);
    throw new Error(`Twitter API error: ${error.error || error.detail || "Unknown error"}`);
  }

  const data = await response.json();

  // Map users by ID for easy lookup
  const usersById = {};
  if (data.includes?.users) {
    data.includes.users.forEach(user => {
      usersById[user.id] = user;
    });
  }

  // Parse tweets
  const tweets = (data.data || []).map(tweet => {
    const author = usersById[tweet.author_id] || {};
    const metrics = tweet.public_metrics || {};

    return {
      post_id: tweet.id,
      content: tweet.text,
      platform_user_id: tweet.author_id,
      author_username: author.username,
      author_name: author.name,
      posted_at: tweet.created_at,
      like_count: metrics.like_count || 0,
      retweet_count: metrics.retweet_count || 0,
      reply_count: metrics.reply_count || 0,
    };
  });

  return tweets;
}

/**
 * Extract topics from a batch of tweets using AI
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
    console.warn(`[Sync Curated Topic] Failed to extract topics with AI:`, error.message);
    return tweets.map(() => []);
  }
}

export default async function syncCuratedTopic(job) {
  const { curatedTopicId } = job.data;

  console.log(`[Sync Curated Topic] Starting sync for topic: ${curatedTopicId}`);

  try {
    // Get curated topic
    const topic = await CuratedTopic.query().findById(curatedTopicId);

    if (!topic) {
      throw new Error(`Curated topic ${curatedTopicId} not found`);
    }

    if (!topic.twitter_list_id) {
      console.log(`[Sync Curated Topic] Topic ${topic.slug} has no twitter_list_id, skipping`);
      return {
        success: false,
        skipped: true,
        reason: "No twitter_list_id",
      };
    }

    console.log(`[Sync Curated Topic] Syncing "${topic.name}" (${topic.slug}) from list ${topic.twitter_list_id}`);

    // Use Ghost app's Twitter access token (from env or a system account)
    // For now, we'll need a bearer token with app-level access
    const accessToken = process.env.TWITTER_BEARER_TOKEN || process.env.TWITTER_API_BEARER_TOKEN;

    if (!accessToken) {
      throw new Error("No TWITTER_BEARER_TOKEN found in environment. This is required for accessing public lists.");
    }

    // Fetch tweets from the list
    const tweets = await getListTweets(topic.twitter_list_id, accessToken, {
      maxResults: 100,
    });

    console.log(`[Sync Curated Topic] Fetched ${tweets.length} tweets from list`);

    if (tweets.length === 0) {
      console.log(`[Sync Curated Topic] No tweets found in list`);
      await topic.$query().patch({
        last_synced_at: new Date().toISOString(),
      });
      return {
        success: true,
        posts_synced: 0,
      };
    }

    // Extract topics in batches
    const batchSize = 10;
    const allTopics = [];

    for (let i = 0; i < tweets.length; i += batchSize) {
      const batch = tweets.slice(i, i + batchSize);
      const batchTopics = await extractTopicsFromBatch(batch);
      allTopics.push(...batchTopics);
    }

    // Store posts in database
    let stored = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      const topics = allTopics[i] || [];

      const engagementScore =
        (tweet.like_count * 1.0) +
        (tweet.retweet_count * 2.0) +
        (tweet.reply_count * 1.5);

      try {
        // Check if post already exists
        const existing = await NetworkPost.query()
          .where("post_id", tweet.post_id)
          .where("curated_topic_id", topic.id)
          .first();

        if (existing) {
          // Update engagement metrics
          await NetworkPost.query()
            .where("id", existing.id)
            .patch({
              like_count: tweet.like_count,
              retweet_count: tweet.retweet_count,
              reply_count: tweet.reply_count,
              engagement_score: engagementScore,
              topics,
            });
          updated++;
        } else {
          // Insert new post
          await NetworkPost.query().insert({
            curated_topic_id: topic.id,
            connected_account_id: null, // Curated posts don't belong to a specific user
            platform: "twitter",
            post_id: tweet.post_id,
            platform_user_id: tweet.platform_user_id,
            content: tweet.content,
            posted_at: tweet.posted_at,
            like_count: tweet.like_count,
            retweet_count: tweet.retweet_count,
            reply_count: tweet.reply_count,
            engagement_score: engagementScore,
            topics,
          });
          stored++;
        }
      } catch (error) {
        console.warn(`[Sync Curated Topic] Failed to store post ${tweet.post_id}:`, error.message);
        skipped++;
      }
    }

    // Update topic's last_synced_at
    await topic.$query().patch({
      last_synced_at: new Date().toISOString(),
    });

    console.log(`[Sync Curated Topic] Sync complete for "${topic.name}": ${stored} new, ${updated} updated, ${skipped} skipped`);

    // Queue digest job for this topic
    console.log(`[Sync Curated Topic] Queueing digest job for topic ${topic.id}`);
    await ghostQueue.add(
      JOB_DIGEST_RECENT_TOPICS,
      { curatedTopicId: topic.id },
      {
        jobId: `digest-topic-${topic.id}-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    return {
      success: true,
      topic: topic.name,
      posts_synced: tweets.length,
      new_posts: stored,
      updated_posts: updated,
      skipped_posts: skipped,
    };

  } catch (error) {
    console.error(`[Sync Curated Topic] Error:`, error);
    throw error;
  }
}
