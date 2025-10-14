/**
 * Analyze Writing Style Job
 * Analyzes user's writing style from their post history
 */

import { ConnectedAccount, UserPostHistory, WritingStyle } from "#src/models/index.js";
import twitterService from "#src/services/twitter.js";
import styleAnalyzer from "#src/services/ai/style-analyzer.js";

export const JOB_ANALYZE_STYLE = "analyze-style";

export default async function analyzeStyle(job) {
  const { connectedAccountId } = job.data;

  console.log(`[Analyze Style] Starting analysis for connected account: ${connectedAccountId}`);

  try {
    // Get connected account
    const connectedAccount = await ConnectedAccount.query().findById(connectedAccountId);

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
    }

    if (!connectedAccount.access_token) {
      throw new Error(`Connected account ${connectedAccountId} has no access token`);
    }

    const { access_token, platform_user_id } = connectedAccount;

    // Step 1: Fetch user's recent tweets
    console.log(`[Analyze Style] Fetching user's posts...`);
    const { tweets } = await twitterService.getUserTweets(access_token, platform_user_id, {
      maxResults: 100,
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

    // Step 3: Analyze writing style with AI
    console.log(`[Analyze Style] Running AI analysis...`);
    const styleData = await styleAnalyzer.analyzeStyle(tweets, {
      platform: connectedAccount.platform,
    });

    job.updateProgress(80);

    // Step 4: Save or update writing style
    console.log(`[Analyze Style] Saving writing style...`);
    await WritingStyle.query()
      .insert({
        connected_account_id: connectedAccount.id,
        tone: styleData.tone,
        avg_length: styleData.avg_length,
        emoji_frequency: styleData.emoji_frequency,
        hashtag_frequency: styleData.hashtag_frequency,
        question_frequency: styleData.question_frequency,
        common_phrases: styleData.common_phrases,
        common_topics: styleData.common_topics,
        posting_times: styleData.posting_times,
        style_summary: styleData.style_summary,
        sample_size: styleData.sample_size,
        confidence_score: styleData.confidence_score,
        analyzed_at: styleData.analyzed_at,
      })
      .onConflict("connected_account_id")
      .merge();

    // Update connected account's last_analyzed_at
    await connectedAccount.$query().patch({
      last_analyzed_at: new Date().toISOString(),
    });

    job.updateProgress(100);

    console.log(`[Analyze Style] Analysis completed successfully`);
    console.log(`  - Tone: ${styleData.tone}`);
    console.log(`  - Avg length: ${styleData.avg_length}`);
    console.log(`  - Confidence: ${styleData.confidence_score}`);

    return {
      success: true,
      posts_analyzed: tweets.length,
      style: {
        tone: styleData.tone,
        avg_length: styleData.avg_length,
        confidence_score: styleData.confidence_score,
      },
      completed_at: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[Analyze Style] Error:`, error);
    throw error; // Re-throw to trigger job retry
  }
}
