/**
 * Generate Suggestions Job
 * Generates daily post suggestions based on:
 * - Network activity (for Twitter, LinkedIn, etc.)
 * - Topics of interest (for Ghost platform)
 */

import { ConnectedAccount, NetworkPost, PostSuggestion, WritingStyle, SamplePost } from "#src/models/index.js";
import suggestionGenerator from "#src/services/ai/suggestion-generator.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const JOB_GENERATE_SUGGESTIONS = "generate-suggestions";

export default async function generateSuggestions(job) {
  const { connectedAccountId, suggestionCount = 3 } = job.data;

  console.log(`[Generate Suggestions] Starting for connected account: ${connectedAccountId}`);

  try {
    // Get connected account with writing style and sample posts
    const connectedAccount = await ConnectedAccount.query()
      .findById(connectedAccountId)
      .withGraphFetched("[writing_style, sample_posts]");

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
    }

    // Branch logic based on platform type
    const isGhostPlatform = connectedAccount.platform === "ghost";

    if (isGhostPlatform) {
      console.log(`[Generate Suggestions] Ghost platform - using interest-based generation`);
      return await generateInterestBasedSuggestions(job, connectedAccount, suggestionCount);
    } else {
      console.log(`[Generate Suggestions] Network platform - using network-based generation`);
      return await generateNetworkBasedSuggestions(job, connectedAccount, suggestionCount);
    }

  } catch (error) {
    console.error(`[Generate Suggestions] Error:`, error);
    throw error; // Re-throw to trigger job retry
  }
}

/**
 * Generate suggestions for ghost platform based on topics of interest
 */
async function generateInterestBasedSuggestions(job, connectedAccount, suggestionCount) {
  let { topics_of_interest, voice, sample_posts } = connectedAccount;

  // Check if we have topics of interest
  const hasTopics = topics_of_interest && topics_of_interest.trim().length > 0;
  const hasSamples = sample_posts && sample_posts.length > 0;

  // If no topics but we have sample posts, infer topics from samples
  if (!hasTopics && hasSamples) {
    console.log(`[Generate Suggestions] No topics defined, inferring from ${sample_posts.length} sample posts...`);

    try {
      const sampleContents = sample_posts.map(p => p.content);
      const topicsPrompt = `Based on these ${sample_posts.length} social media post${sample_posts.length > 1 ? 's' : ''}, identify 3-5 main topics or themes this person likes to write about. Be specific and concise.

Post${sample_posts.length > 1 ? 's' : ''}:
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

      topics_of_interest = response.choices[0].message.content.trim();
      console.log(`[Generate Suggestions] Inferred topics: "${topics_of_interest}"`);

      // Save the inferred topics for future use
      await connectedAccount.$query().patch({
        topics_of_interest,
      });
      console.log(`[Generate Suggestions] Saved inferred topics to connected account`);

    } catch (error) {
      console.warn(`[Generate Suggestions] Failed to infer topics:`, error.message);
      // Fall through to error below
    }
  }

  // Check if we have topics now (either existing or inferred)
  if (!topics_of_interest || topics_of_interest.trim().length === 0) {
    console.log(`[Generate Suggestions] No topics of interest and no sample posts to infer from`);
    return {
      success: false,
      message: "Need either topics_of_interest or sample posts to generate suggestions. Please add topics or sample posts.",
    };
  }

  console.log(`[Generate Suggestions] Topics: ${topics_of_interest}`);
  job.updateProgress(40);

  // Generate suggestions using topics + voice + samples
  console.log(`[Generate Suggestions] Generating ${suggestionCount} interest-based suggestions...`);
  const result = await suggestionGenerator.generateInterestBasedSuggestions({
    topics: topics_of_interest,
    voice: voice,
    samplePosts: sample_posts?.map(sp => ({
      content: sp.content,
      notes: sp.notes,
    })) || [],
    platform: connectedAccount.platform,
    suggestionCount,
  });

  console.log(`[Generate Suggestions] Generated ${result.suggestions.length} suggestions`);
  job.updateProgress(70);

  // Save suggestions to database
  console.log(`[Generate Suggestions] Saving suggestions...`);
  let savedCount = 0;

  for (const suggestion of result.suggestions) {
    try {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await PostSuggestion.query().insert({
        account_id: connectedAccount.account_id,
        connected_account_id: connectedAccount.id,
        app_id: connectedAccount.app_id,
        suggestion_type: "original_post",
        content: suggestion.content,
        reasoning: suggestion.reasoning,
        source_post_id: null,
        topics: suggestion.topics || [],
        angle: suggestion.angle,
        length: suggestion.length,
        character_count: suggestion.content.length,
        expires_at: expiresAt.toISOString(),
        status: "pending",
      });

      savedCount++;
    } catch (error) {
      console.warn(`Failed to save suggestion:`, error.message);
    }
  }

  job.updateProgress(100);

  console.log(`[Generate Suggestions] Saved ${savedCount} suggestions`);

  return {
    success: true,
    suggestions_generated: savedCount,
    generation_type: "interest_based",
    completed_at: new Date().toISOString(),
  };
}

/**
 * Generate suggestions based on network activity
 */
async function generateNetworkBasedSuggestions(job, connectedAccount, suggestionCount) {
  const writingStyle = connectedAccount.writing_style;

  // Step 1: Determine the timestamp to fetch posts from (incremental)
  // Find the latest network post we've stored
  const latestPost = await NetworkPost.query()
    .where("connected_account_id", connectedAccount.id)
    .orderBy("posted_at", "desc")
    .first();

  // Default to 48 hours ago if no posts exist
  const sinceTimestamp = latestPost
    ? new Date(latestPost.posted_at)
    : new Date(Date.now() - 48 * 60 * 60 * 1000);

  console.log(`[Generate Suggestions] Fetching posts since: ${sinceTimestamp.toISOString()}`);

  // Step 2: Get trending topics from posts since last fetch
  console.log(`[Generate Suggestions] Getting trending topics...`);
  const hoursBack = Math.ceil((Date.now() - sinceTimestamp.getTime()) / (1000 * 60 * 60));
  const trendingTopics = await NetworkPost.getTrendingTopics(connectedAccount.id, hoursBack, 10);

  console.log(`[Generate Suggestions] Found ${trendingTopics.length} trending topics`);
  job.updateProgress(20);

  // Step 3: Get high-engagement posts from network (incremental)
  console.log(`[Generate Suggestions] Getting high-engagement posts...`);
  const trendingPosts = await NetworkPost.query()
    .where("connected_account_id", connectedAccount.id)
    .where("posted_at", ">", sinceTimestamp.toISOString())
    .whereNotNull("engagement_score")
    .orderBy("engagement_score", "desc")
    .limit(20);

  console.log(`[Generate Suggestions] Found ${trendingPosts.length} trending posts`);
  job.updateProgress(45);

  // Step 4: Generate new suggestions with AI
  console.log(`[Generate Suggestions] Generating ${suggestionCount} suggestions...`);
  const result = await suggestionGenerator.generateSuggestions({
    trendingPosts: trendingPosts.map(p => ({
      content: p.content,
      engagement_score: p.engagement_score,
      author_username: p.platform_user_id,
    })),
    trendingTopics: trendingTopics.map(t => ({
      topic: t.topic,
      mention_count: t.mention_count,
      total_engagement: t.total_engagement,
      last_mentioned: t.last_mentioned,
    })),
    writingStyle: writingStyle ? {
      tone: writingStyle.tone,
      avg_length: writingStyle.avg_length,
      emoji_frequency: writingStyle.emoji_frequency,
      hashtag_frequency: writingStyle.hashtag_frequency,
      common_topics: writingStyle.common_topics,
      style_summary: writingStyle.style_summary,
    } : null,
    voice: connectedAccount.voice,
    samplePosts: connectedAccount.sample_posts?.map(sp => ({
      content: sp.content,
      notes: sp.notes,
    })) || [],
    platform: connectedAccount.platform,
    suggestionCount,
  });

  console.log(`[Generate Suggestions] Generated ${result.suggestions.length} suggestions`);
  job.updateProgress(70);

  // Step 5: Save suggestions to database
  console.log(`[Generate Suggestions] Saving suggestions...`);
  let savedCount = 0;

  for (const suggestion of result.suggestions) {
    try {
      // Set expiration time (24 hours from now)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      // Find source post if it's a reply
      let sourcePostId = null;
      if (suggestion.type === "reply" && suggestion.source_post_id) {
        const sourcePost = await NetworkPost.query()
          .where("connected_account_id", connectedAccount.id)
          .where("post_id", suggestion.source_post_id)
          .first();

        if (sourcePost) {
          sourcePostId = sourcePost.id;
        }
      }

      await PostSuggestion.query().insert({
        account_id: connectedAccount.account_id,
        connected_account_id: connectedAccount.id,
        app_id: connectedAccount.app_id,
        suggestion_type: suggestion.type || "original_post",
        content: suggestion.content,
        reasoning: suggestion.reasoning,
        source_post_id: sourcePostId,
        topics: suggestion.topics || [],
        angle: suggestion.angle,
        length: suggestion.length,
        character_count: suggestion.content.length,
        expires_at: expiresAt.toISOString(),
        status: "pending",
      });

      savedCount++;
    } catch (error) {
      console.warn(`Failed to save suggestion:`, error.message);
    }
  }

  job.updateProgress(100);

  console.log(`[Generate Suggestions] Saved ${savedCount} suggestions`);
  console.log(`[Generate Suggestions] Suggestions generated successfully`);

  return {
    success: true,
    suggestions_generated: savedCount,
    generation_type: "network_based",
    trending_topics: trendingTopics.length,
    trending_posts: trendingPosts.length,
    completed_at: new Date().toISOString(),
  };
}
