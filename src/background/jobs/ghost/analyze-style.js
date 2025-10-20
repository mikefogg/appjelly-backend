/**
 * Analyze Writing Style Job
 * Analyzes user's writing style from their post history
 * Auto-creates sample posts and generates voice from best-performing content
 */

import { ConnectedAccount, UserPostHistory, WritingStyle, SamplePost } from "#src/models/index.js";
import twitterService from "#src/services/twitter.js";
import styleAnalyzer from "#src/services/ai/style-analyzer.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    job.updateProgress(85);

    // Step 5: Auto-create sample posts from top-performing content
    console.log(`[Analyze Style] Selecting top posts for samples...`);
    const topPosts = await UserPostHistory.query()
      .where("connected_account_id", connectedAccount.id)
      .orderBy("engagement_score", "desc")
      .limit(5);

    let samplesCreated = 0;
    if (topPosts.length >= 3) {
      // Delete existing auto-generated samples (keep manually created ones)
      await SamplePost.query()
        .where("connected_account_id", connectedAccount.id)
        .where("metadata:auto_generated", true)
        .delete();

      // Create sample posts from top 3-5 posts
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
      console.log(`[Analyze Style] Not enough posts to create samples (need at least 3)`);
    }

    job.updateProgress(90);

    // Step 6: Generate voice description using AI
    console.log(`[Analyze Style] Generating voice description...`);
    let voiceDescription = null;

    if (samplesCreated >= 3) {
      try {
        const sampleContents = topPosts.slice(0, samplesCreated).map(p => p.content);

        const voicePrompt = `Analyze these ${samplesCreated} social media posts and describe the author's writing voice in 2-3 concise sentences. Focus on tone, style, personality, and distinctive patterns.

Posts:
${sampleContents.map((content, i) => `${i + 1}. "${content}"`).join('\n')}

Writing Style Analysis:
- Tone: ${styleData.tone}
- Average length: ${styleData.avg_length} characters
- Emoji usage: ${styleData.emoji_frequency > 0.5 ? 'frequent' : styleData.emoji_frequency > 0.2 ? 'occasional' : 'rare'}
- Common topics: ${styleData.common_topics?.slice(0, 3).join(', ') || 'varied'}

Describe this person's voice in a way that helps an AI ghostwriter mimic their style. Be specific about tone, word choice, sentence structure, and personality. Keep it under 200 characters.`;

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are an expert at analyzing writing styles and creating concise voice descriptions for AI ghostwriting."
            },
            {
              role: "user",
              content: voicePrompt
            }
          ],
          temperature: 0.7,
          max_tokens: 200,
        });

        voiceDescription = response.choices[0].message.content.trim();
        console.log(`[Analyze Style] Generated voice: "${voiceDescription}"`);

      } catch (error) {
        console.warn(`[Analyze Style] Failed to generate voice:`, error.message);
      }
    }

    // Update connected account with voice and last_analyzed_at
    await connectedAccount.$query().patch({
      voice: voiceDescription,
      last_analyzed_at: new Date().toISOString(),
    });

    job.updateProgress(100);

    console.log(`[Analyze Style] Analysis completed successfully`);
    console.log(`  - Tone: ${styleData.tone}`);
    console.log(`  - Avg length: ${styleData.avg_length}`);
    console.log(`  - Confidence: ${styleData.confidence_score}`);
    console.log(`  - Sample posts created: ${samplesCreated}`);
    console.log(`  - Voice generated: ${voiceDescription ? 'Yes' : 'No'}`);

    return {
      success: true,
      posts_analyzed: tweets.length,
      samples_created: samplesCreated,
      voice_generated: !!voiceDescription,
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
