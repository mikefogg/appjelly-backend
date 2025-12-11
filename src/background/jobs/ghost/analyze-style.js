/**
 * Analyze Writing Style Job
 * Analyzes user's writing style from their post history
 * Auto-creates sample posts and generates voice from best-performing content
 */

import { ConnectedAccount, UserPostHistory, WritingStyle, SamplePost } from "#src/models/index.js";
import twitterService from "#src/services/twitter.js";
import AI from "#src/services/ai/index.js";
import rateLimiter from "#src/services/rate-limiter.js";
import { ghostQueue } from "#src/background/queues/index.js";

export const JOB_ANALYZE_STYLE = "analyze-style";

/**
 * Analyze ghost account (no network posts, only manual samples)
 */
async function analyzeGhostAccount(job, connectedAccount) {
  console.log(`[Analyze Style] Analyzing ghost account ${connectedAccount.id}`);

  // Skip if already analyzed (we only analyze once per account)
  if (connectedAccount.last_analyzed_at) {
    console.log(`[Analyze Style] Ghost account ${connectedAccount.id} already analyzed at ${connectedAccount.last_analyzed_at} - skipping`);
    return {
      success: true,
      skipped: true,
      reason: "Already analyzed",
      analyzed_at: connectedAccount.last_analyzed_at,
    };
  }

  // Fetch manually created sample posts
  const samplePosts = await SamplePost.query()
    .where("connected_account_id", connectedAccount.id)
    .orderBy("sort_order", "asc");

  console.log(`[Analyze Style] Found ${samplePosts.length} manual sample posts`);

  // Sample posts are optional - ghost accounts can work without them
  if (samplePosts.length === 0) {
    console.log(`[Analyze Style] No sample posts found - ghost account will use manual voice/topics only`);
    await connectedAccount.$query().patch({
      last_analyzed_at: new Date().toISOString(),
    });

    return {
      success: true,
      message: "Ghost account analyzed - no sample posts to process",
      sample_posts_found: 0,
      voice_generated: false,
      topics_generated: false,
    };
  }

  job.updateProgress(30);

  // Generate voice and topics using AI (single call returns both)
  console.log(`[Analyze Style] Generating voice and topics from samples...`);
  let voiceDescription = null;
  let topicsOfInterest = null;

  try {
    const sampleContents = samplePosts.map(p => p.content);
    const result = await AI.analyzeVoice({ samplePosts: sampleContents });

    voiceDescription = result.voice;
    topicsOfInterest = result.topics;

    console.log(`[Analyze Style] Generated voice: "${voiceDescription}"`);
    console.log(`[Analyze Style] Generated topics: "${topicsOfInterest}"`);
  } catch (error) {
    console.warn(`[Analyze Style] Failed to analyze voice:`, error.message);
  }

  job.updateProgress(90);

  // Update connected account with voice, topics, and last_analyzed_at
  await connectedAccount.$query().patch({
    voice: voiceDescription,
    topics_of_interest: topicsOfInterest,
    last_analyzed_at: new Date().toISOString(),
  });

  job.updateProgress(100);

  console.log(`[Analyze Style] Ghost account analysis completed`);
  console.log(`  - Sample posts analyzed: ${samplePosts.length}`);
  console.log(`  - Voice generated: ${voiceDescription ? 'Yes' : 'No'}`);
  console.log(`  - Topics generated: ${topicsOfInterest ? 'Yes' : 'No'}`);

  return {
    success: true,
    sample_posts_analyzed: samplePosts.length,
    voice_generated: !!voiceDescription,
    topics_generated: !!topicsOfInterest,
    completed_at: new Date().toISOString(),
  };
}

/**
 * Calculate basic stats from posts (no AI needed)
 */
function calculateBasicStats(posts) {
  if (posts.length === 0) {
    return {
      avg_length: 0,
      emoji_frequency: 0,
      hashtag_frequency: 0,
      question_frequency: 0,
    };
  }

  let totalLength = 0;
  let emojiCount = 0;
  let hashtagCount = 0;
  let questionCount = 0;

  for (const post of posts) {
    const content = post.content || '';
    totalLength += content.length;

    if (/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u.test(content)) {
      emojiCount++;
    }
    if (content.includes('#')) {
      hashtagCount++;
    }
    if (content.includes('?')) {
      questionCount++;
    }
  }

  return {
    avg_length: Math.round(totalLength / posts.length),
    emoji_frequency: emojiCount / posts.length,
    hashtag_frequency: hashtagCount / posts.length,
    question_frequency: questionCount / posts.length,
  };
}

export default async function analyzeStyle(job) {
  const { connectedAccountId } = job.data;

  console.log(`[Analyze Style] Starting analysis for connected account: ${connectedAccountId}`);

  try {
    // Get connected account
    const connectedAccount = await ConnectedAccount.query().findById(connectedAccountId);

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
    }

    // Skip if already analyzed (we only analyze once per account)
    if (connectedAccount.last_analyzed_at) {
      console.log(`[Analyze Style] Account ${connectedAccountId} already analyzed at ${connectedAccount.last_analyzed_at} - skipping`);
      return {
        success: true,
        skipped: true,
        reason: "Already analyzed",
        analyzed_at: connectedAccount.last_analyzed_at,
      };
    }

    // Handle ghost platform differently - no network posts to analyze
    const isGhostPlatform = connectedAccount.platform === "ghost";

    if (isGhostPlatform) {
      console.log(`[Analyze Style] Ghost platform - analyzing manual sample posts only`);
      return await analyzeGhostAccount(job, connectedAccount);
    }

    if (!connectedAccount.access_token) {
      throw new Error(`Connected account ${connectedAccountId} has no access token`);
    }

    // Get valid access token (will refresh if expired)
    const access_token = await connectedAccount.getValidAccessToken();
    const { platform_user_id } = connectedAccount;

    if (!access_token) {
      throw new Error(`Failed to get valid access token for account ${connectedAccountId}`);
    }

    // Check rate limit BEFORE making any API call
    console.log(`[Analyze Style] Checking rate limit for user_tweets endpoint...`);
    const rateLimitCheck = await rateLimiter.checkRateLimit("user_tweets", platform_user_id);

    if (!rateLimitCheck.allowed) {
      const delayMs = rateLimitCheck.retryAfter * 1000;
      console.log(
        `[Analyze Style] Rate limited! Scheduling delayed job in ${rateLimitCheck.retryAfter}s ` +
        `(at ${new Date(Date.now() + delayMs).toISOString()})`
      );

      // Schedule a delayed job with the same jobId (will replace this one)
      await ghostQueue.add(
        JOB_ANALYZE_STYLE,
        { connectedAccountId },
        {
          jobId: `analyze-style-${connectedAccountId}`,
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

    console.log(`[Analyze Style] Rate limit OK - proceeding with API call`);

    // Step 1: Fetch user's recent tweets
    console.log(`[Analyze Style] Fetching user's posts...`);
    const { tweets } = await twitterService.getUserTweets(access_token, platform_user_id, {
      maxResults: 10, // Conservative limit for Free tier (100 posts/month cap)
    });

    console.log(`[Analyze Style] Found ${tweets.length} posts`);

    if (tweets.length < 5) {
      console.log(`[Analyze Style] Not enough posts for analysis (need at least 5)`);
      return {
        success: false,
        message: "Not enough posts for style analysis",
      };
    }

    job.updateProgress(30);

    // Step 2: Save posts to user_post_history
    console.log(`[Analyze Style] Saving posts to history...`);
    let postsSaved = 0;

    for (const tweet of tweets) {
      try {
        // Analyze post characteristics
        const characterCount = tweet.content.length;
        const hasEmoji = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u.test(tweet.content);
        const hasHashtags = tweet.content.includes("#");
        const hasMentions = tweet.content.includes("@");
        const tone = twitterService.analyzeSentiment(tweet.content);

        await UserPostHistory.query()
          .insert({
            connected_account_id: connectedAccount.id,
            platform: connectedAccount.platform,
            post_id: tweet.post_id,
            content: tweet.content,
            posted_at: tweet.posted_at,
            reply_count: tweet.reply_count,
            retweet_count: tweet.retweet_count,
            like_count: tweet.like_count,
            engagement_score: tweet.engagement_score,
            character_count: characterCount,
            has_emoji: hasEmoji,
            has_hashtags: hasHashtags,
            has_mentions: hasMentions,
            tone,
          })
          .onConflict(["connected_account_id", "post_id"])
          .ignore();

        postsSaved++;
      } catch (error) {
        console.warn(`Failed to save post ${tweet.post_id}:`, error.message);
      }
    }

    console.log(`[Analyze Style] Saved ${postsSaved} posts`);
    job.updateProgress(50);

    // Step 3: Calculate basic stats (no AI needed)
    console.log(`[Analyze Style] Calculating basic stats...`);
    const basicStats = calculateBasicStats(tweets);

    job.updateProgress(60);

    // Step 4: Auto-create sample posts from top-performing content
    console.log(`[Analyze Style] Selecting top posts for samples...`);
    const topPosts = await UserPostHistory.query()
      .where("connected_account_id", connectedAccount.id)
      .orderBy("engagement_score", "desc")
      .limit(5);

    let samplesCreated = 0;
    if (topPosts.length >= 1) {
      // Delete existing auto-generated samples (keep manually created ones)
      await SamplePost.query()
        .where("connected_account_id", connectedAccount.id)
        .whereJsonSupersetOf("metadata", { auto_generated: true })
        .delete();

      // Create sample posts from top posts (at least 1, up to 5)
      const samplesToCreate = topPosts.slice(0, Math.min(5, topPosts.length));

      for (let i = 0; i < samplesToCreate.length; i++) {
        const post = samplesToCreate[i];
        try {
          await SamplePost.query().insert({
            connected_account_id: connectedAccount.id,
            content: post.content,
            notes: `High engagement: ${post.like_count} likes, ${post.retweet_count} retweets`,
            sort_order: i,
            metadata: {
              auto_generated: true,
              source_post_id: post.post_id,
              engagement_score: post.engagement_score,
              created_at: new Date().toISOString(),
            },
          });
          samplesCreated++;
        } catch (error) {
          console.warn(`Failed to create sample post:`, error.message);
        }
      }

      console.log(`[Analyze Style] Created ${samplesCreated} sample posts`);
    } else {
      console.log(`[Analyze Style] No posts available to create samples - user can add manually if desired`);
    }

    job.updateProgress(70);

    // Step 5: Generate voice and topics using AI (single call returns both)
    console.log(`[Analyze Style] Generating voice and topics...`);
    let voiceDescription = null;
    let topicsOfInterest = null;
    let styleData = {
      tone: "conversational",
      style_summary: null,
      confidence_score: 0.5,
    };

    if (samplesCreated >= 1) {
      try {
        const sampleContents = topPosts.slice(0, samplesCreated).map(p => p.content);
        const result = await AI.analyzeVoice({ samplePosts: sampleContents });

        voiceDescription = result.voice;
        topicsOfInterest = result.topics;
        styleData.confidence_score = result.confidence;
        styleData.style_summary = result.voice;

        console.log(`[Analyze Style] Generated voice: "${voiceDescription}"`);
        console.log(`[Analyze Style] Generated topics: "${topicsOfInterest}"`);
      } catch (error) {
        console.warn(`[Analyze Style] Failed to analyze voice:`, error.message);
      }
    }

    job.updateProgress(85);

    // Step 6: Save writing style
    console.log(`[Analyze Style] Saving writing style...`);

    await WritingStyle.query()
      .insert({
        connected_account_id: connectedAccount.id,
        tone: styleData.tone,
        avg_length: basicStats.avg_length,
        emoji_frequency: basicStats.emoji_frequency,
        hashtag_frequency: basicStats.hashtag_frequency,
        question_frequency: basicStats.question_frequency,
        common_phrases: null,
        common_topics: topicsOfInterest ? topicsOfInterest.split(',').map(t => t.trim()) : null,
        posting_times: null,
        style_summary: styleData.style_summary,
        sample_size: tweets.length,
        confidence_score: styleData.confidence_score,
        analyzed_at: new Date().toISOString(),
      })
      .onConflict("connected_account_id")
      .merge();

    job.updateProgress(90);

    // Update connected account with voice, topics, and last_analyzed_at
    await connectedAccount.$query().patch({
      voice: voiceDescription,
      topics_of_interest: topicsOfInterest,
      last_analyzed_at: new Date().toISOString(),
    });

    job.updateProgress(100);

    console.log(`[Analyze Style] Analysis completed successfully`);
    console.log(`  - Avg length: ${basicStats.avg_length}`);
    console.log(`  - Confidence: ${styleData.confidence_score}`);
    console.log(`  - Sample posts created: ${samplesCreated}`);
    console.log(`  - Voice generated: ${voiceDescription ? 'Yes' : 'No'}`);
    console.log(`  - Topics generated: ${topicsOfInterest ? 'Yes' : 'No'}`);

    return {
      success: true,
      posts_analyzed: tweets.length,
      samples_created: samplesCreated,
      voice_generated: !!voiceDescription,
      topics_generated: !!topicsOfInterest,
      style: {
        avg_length: basicStats.avg_length,
        confidence_score: styleData.confidence_score,
      },
      completed_at: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[Analyze Style] Error:`, error);
    throw error; // Re-throw to trigger job retry
  }
}
