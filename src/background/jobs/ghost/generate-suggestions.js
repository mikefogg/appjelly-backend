/**
 * Generate Suggestions Job
 * Generates daily post suggestions based on network activity
 */

import { ConnectedAccount, NetworkPost, PostSuggestion, WritingStyle } from "#src/models/index.js";
import suggestionGenerator from "#src/services/ai/suggestion-generator.js";

export const JOB_GENERATE_SUGGESTIONS = "generate-suggestions";

export default async function generateSuggestions(job) {
  const { connectedAccountId, suggestionCount = 3 } = job.data;

  console.log(`[Generate Suggestions] Starting for connected account: ${connectedAccountId}`);

  try {
    // Get connected account with writing style
    const connectedAccount = await ConnectedAccount.query()
      .findById(connectedAccountId)
      .withGraphFetched("writing_style");

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
    }

    const writingStyle = connectedAccount.writing_style;

    // Step 1: Get trending topics from last 48 hours
    console.log(`[Generate Suggestions] Getting trending topics...`);
    const trendingTopics = await NetworkPost.getTrendingTopics(connectedAccountId, 48, 10);

    console.log(`[Generate Suggestions] Found ${trendingTopics.length} trending topics`);
    job.updateProgress(20);

    // Step 2: Get high-engagement posts from network
    console.log(`[Generate Suggestions] Getting high-engagement posts...`);
    const trendingPosts = await NetworkPost.query()
      .where("connected_account_id", connectedAccountId)
      .where("posted_at", ">", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .whereNotNull("engagement_score")
      .orderBy("engagement_score", "desc")
      .limit(20);

    console.log(`[Generate Suggestions] Found ${trendingPosts.length} trending posts`);
    job.updateProgress(40);

    // Step 3: Expire old suggestions
    console.log(`[Generate Suggestions] Expiring old suggestions...`);
    await PostSuggestion.expireOld();

    job.updateProgress(50);

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
        count: t.count,
      })),
      writingStyle: writingStyle ? {
        tone: writingStyle.tone,
        avg_length: writingStyle.avg_length,
        emoji_frequency: writingStyle.emoji_frequency,
        hashtag_frequency: writingStyle.hashtag_frequency,
        common_topics: writingStyle.common_topics,
        style_summary: writingStyle.style_summary,
      } : null,
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
            .where("connected_account_id", connectedAccountId)
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
      trending_topics: trendingTopics.length,
      trending_posts: trendingPosts.length,
      completed_at: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[Generate Suggestions] Error:`, error);
    throw error; // Re-throw to trigger job retry
  }
}
