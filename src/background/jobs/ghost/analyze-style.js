/**
 * Analyze Writing Style Job
 * Analyzes user's writing style from their post history
 * Auto-creates sample posts and generates voice from best-performing content
 */

import { ConnectedAccount, UserPostHistory, WritingStyle, SamplePost } from "#src/models/index.js";
import twitterService from "#src/services/twitter.js";
import styleAnalyzer from "#src/services/ai/style-analyzer.js";
import rateLimiter from "#src/services/rate-limiter.js";
import { ghostQueue } from "#src/background/queues/index.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const JOB_ANALYZE_STYLE = "analyze-style";

/**
 * Analyze ghost account (no network posts, only manual samples)
 */
async function analyzeGhostAccount(job, connectedAccount) {
  console.log(`[Analyze Style] Analyzing ghost account ${connectedAccount.id}`);

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

  // Generate voice description using AI (only if we have sample posts)
  console.log(`[Analyze Style] Generating voice description from samples...`);
  let voiceDescription = null;

  if (samplePosts.length >= 1) {
    try {
      const sampleContents = samplePosts.map(p => p.content);

      const voicePrompt = `Analyze these ${samplePosts.length} social media post${samplePosts.length > 1 ? 's' : ''} and describe the author's writing voice in 2-3 concise sentences. Focus on tone, style, personality, and distinctive patterns.

Post${samplePosts.length > 1 ? 's' : ''}:
${sampleContents.map((content, i) => `${i + 1}. "${content}"`).join('\n')}

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
  } else {
    console.log(`[Analyze Style] Skipping voice generation - need at least 1 sample post`);
  }

  job.updateProgress(60);

  // Generate topics_of_interest using AI (only if we have sample posts)
  console.log(`[Analyze Style] Generating topics of interest from samples...`);
  let topicsOfInterest = null;

  if (samplePosts.length >= 1) {
    try {
      const sampleContents = samplePosts.map(p => p.content);

      const topicsPrompt = `Based on these ${samplePosts.length} social media post${samplePosts.length > 1 ? 's' : ''}, identify 3-5 main topics or themes this person likes to write about. Be specific and concise.

Post${samplePosts.length > 1 ? 's' : ''}:
${sampleContents.map((content, i) => `${i + 1}. "${content}"`).join('\n')}

List the topics as a comma-separated list (e.g., "AI and technology, startup culture, product design"). Keep it under 200 characters.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are an expert at identifying topics and themes from social media content."
          },
          {
            role: "user",
            content: topicsPrompt
          }
        ],
        temperature: 0.7,
        max_tokens: 100,
      });

      topicsOfInterest = response.choices[0].message.content.trim();
      console.log(`[Analyze Style] Generated topics: "${topicsOfInterest}"`);

    } catch (error) {
      console.warn(`[Analyze Style] Failed to generate topics:`, error.message);
    }
  } else {
    console.log(`[Analyze Style] Skipping topics generation - need at least 1 sample post`);
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

export default async function analyzeStyle(job) {
  const { connectedAccountId } = job.data;

  console.log(`[Analyze Style] Starting analysis for connected account: ${connectedAccountId}`);

  try {
    // Get connected account
    const connectedAccount = await ConnectedAccount.query().findById(connectedAccountId);

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
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

    // Decrypt the access token
    const access_token = connectedAccount.getDecryptedAccessToken();
    const { platform_user_id } = connectedAccount;

    if (!access_token) {
      throw new Error(`Failed to decrypt access token for account ${connectedAccountId}`);
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

    // Step 3: Analyze writing style with AI
    console.log(`[Analyze Style] Running AI analysis...`);
    const styleData = await styleAnalyzer.analyzeStyle(tweets, {
      platform: connectedAccount.platform,
    });

    job.updateProgress(80);

    // Step 4: Save or update writing style
    console.log(`[Analyze Style] Saving writing style...`);
    console.log(`[Analyze Style] Style data:`, JSON.stringify(styleData, null, 2));

    await WritingStyle.query()
      .insert({
        connected_account_id: connectedAccount.id,
        tone: styleData.tone,
        avg_length: styleData.avg_length,
        emoji_frequency: styleData.emoji_frequency,
        hashtag_frequency: styleData.hashtag_frequency,
        question_frequency: styleData.question_frequency,
        common_phrases: styleData.common_phrases || null,
        common_topics: styleData.common_topics || null,
        posting_times: styleData.posting_times || null,
        style_summary: styleData.style_summary,
        sample_size: styleData.sample_size,
        confidence_score: styleData.confidence_score,
        analyzed_at: styleData.analyzed_at,
      })
      .onConflict("connected_account_id")
      .merge();

    job.updateProgress(85);

    // Step 5: Auto-create sample posts from top-performing content (optional enhancement)
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

    job.updateProgress(90);

    // Step 6: Generate voice description using AI (optional enhancement)
    console.log(`[Analyze Style] Generating voice description...`);
    let voiceDescription = null;

    if (samplesCreated >= 1) {
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

    // Step 7: Generate topics_of_interest using AI (optional enhancement)
    console.log(`[Analyze Style] Generating topics of interest...`);
    let topicsOfInterest = null;

    if (samplesCreated >= 1) {
      try {
        const sampleContents = topPosts.slice(0, samplesCreated).map(p => p.content);

        const topicsPrompt = `Based on these ${samplesCreated} social media posts, identify 3-5 main topics or themes this person likes to write about. Be specific and concise.

Posts:
${sampleContents.map((content, i) => `${i + 1}. "${content}"`).join('\n')}

Common topics from analysis: ${styleData.common_topics?.slice(0, 5).join(', ') || 'varied'}

List the topics as a comma-separated list (e.g., "AI and technology, startup culture, product design"). Keep it under 200 characters.`;

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are an expert at identifying topics and themes from social media content."
            },
            {
              role: "user",
              content: topicsPrompt
            }
          ],
          temperature: 0.7,
          max_tokens: 100,
        });

        topicsOfInterest = response.choices[0].message.content.trim();
        console.log(`[Analyze Style] Generated topics: "${topicsOfInterest}"`);

      } catch (error) {
        console.warn(`[Analyze Style] Failed to generate topics:`, error.message);
      }
    }

    // Update connected account with voice, topics, and last_analyzed_at
    await connectedAccount.$query().patch({
      voice: voiceDescription,
      topics_of_interest: topicsOfInterest,
      last_analyzed_at: new Date().toISOString(),
    });

    job.updateProgress(100);

    console.log(`[Analyze Style] Analysis completed successfully`);
    console.log(`  - Tone: ${styleData.tone}`);
    console.log(`  - Avg length: ${styleData.avg_length}`);
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
