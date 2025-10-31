/**
 * Generate Suggestions Job
 * Generates daily post suggestions based on:
 * - Network activity (for Twitter, LinkedIn, etc.)
 * - Topics of interest (for Ghost platform)
 */

import { ConnectedAccount, NetworkPost, PostSuggestion, WritingStyle, SamplePost, Rule, UserTopicPreference, TrendingTopic } from "#src/models/index.js";
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

  // Step 1: Check if user has selected curated topics (primary method)
  const userTopicIds = await UserTopicPreference.getUserTopicIds(connectedAccount.id);
  const hasCuratedTopics = userTopicIds.length > 0;

  console.log(`[Generate Suggestions] User has selected ${userTopicIds.length} curated topics`);

  // Step 2: Get trending topics from curated topics (if any selected)
  let trendingTopicsData = [];
  if (hasCuratedTopics) {
    console.log(`[Generate Suggestions] Getting trending topics from curated topics...`);
    trendingTopicsData = await TrendingTopic.getTopTopicsForGeneration(userTopicIds, 20);
    console.log(`[Generate Suggestions] Found ${trendingTopicsData.length} trending topics from curated topics`);
  }

  // Convert trending topics to the format expected by AI
  const trendingTopics = trendingTopicsData.map(t => ({
    topic: t.topic_name,
    mention_count: t.mention_count,
    total_engagement: parseFloat(t.total_engagement || 0),
    context: t.context,
  }));

  // Step 3: Check topic sources (curated, custom text, or samples)
  const hasCustomTopics = topics_of_interest && topics_of_interest.trim().length > 0;
  const hasSamples = sample_posts && sample_posts.length > 0;
  const hasAnyTopicSource = hasCuratedTopics || hasCustomTopics;

  // If no topics but we have sample posts, infer topics from samples
  if (!hasAnyTopicSource && hasSamples) {
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

  // Step 4: Verify we have at least one topic source
  if (!hasCuratedTopics && !topics_of_interest && !hasSamples) {
    console.log(`[Generate Suggestions] No topic sources available (need curated topics OR topics_of_interest OR sample posts)`);
    return {
      success: false,
      message: "Please select curated topics, add topics of interest, or add sample posts to generate suggestions.",
    };
  }

  // Log what we're using
  console.log(`[Generate Suggestions] === GENERATION INPUT ===`);
  console.log(`[Generate Suggestions] Curated Topics Selected: ${hasCuratedTopics ? userTopicIds.length : 0}`);
  console.log(`[Generate Suggestions] Custom Topics of Interest: ${hasCustomTopics ? topics_of_interest : 'none'}`);
  console.log(`[Generate Suggestions] Trending Topics (${trendingTopics.length}):`);
  trendingTopics.forEach((t, idx) => {
    console.log(`  [${idx}] "${t.topic}" (${t.mention_count} mentions, ${t.total_engagement} engagement)`);
  });
  console.log(`[Generate Suggestions] Sample Posts: ${sample_posts?.length || 0}`);
  console.log(`[Generate Suggestions] Voice: ${voice ? voice.substring(0, 100) + '...' : 'none'}`);
  console.log(`[Generate Suggestions] ========================`);

  job.updateProgress(40);

  // Get active rules for this connected account
  const rules = await Rule.getActiveRules(connectedAccount.id);
  console.log(`[Generate Suggestions] Found ${rules.length} active rules`);

  // Generate suggestions using topics + voice + samples + rules
  console.log(`[Generate Suggestions] Generating ${suggestionCount} interest-based suggestions...`);
  const result = await suggestionGenerator.generateInterestBasedSuggestions({
    topics: topics_of_interest || "",
    trendingTopics: trendingTopics,
    voice: voice,
    samplePosts: sample_posts?.map(sp => ({
      content: sp.content,
      notes: sp.notes,
    })) || [],
    rules: rules.map(r => ({
      rule_type: r.rule_type,
      content: r.content,
      priority: r.priority,
    })),
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

      // Build metadata for interest-based suggestions
      const metadata = {
        generation_type: "interest_based",
        had_curated_topics: hasCuratedTopics,
        curated_topics_count: userTopicIds.length,
        trending_topics_count: trendingTopics.length,
        topics_of_interest: topics_of_interest,
        had_voice: !!(voice && voice.trim().length > 0),
        had_samples: !!(sample_posts && sample_posts.length > 0),
        sample_count: sample_posts?.length || 0,
      };

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
        metadata,
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
    curated_topics_count: userTopicIds.length,
    trending_topics_count: trendingTopics.length,
    completed_at: new Date().toISOString(),
  };
}

/**
 * Generate suggestions based on network activity
 */
async function generateNetworkBasedSuggestions(job, connectedAccount, suggestionCount) {
  const writingStyle = connectedAccount.writing_style;

  // Step 1: Check if user has selected curated topics (optional)
  const userTopicIds = await UserTopicPreference.getUserTopicIds(connectedAccount.id);
  const hasCuratedTopics = userTopicIds.length > 0;

  console.log(`[Generate Suggestions] User has selected ${userTopicIds.length} curated topics`);
  job.updateProgress(10);

  // Step 2: Get trending topics from curated topics (if any selected)
  let trendingTopicsData = [];
  if (hasCuratedTopics) {
    console.log(`[Generate Suggestions] Getting trending topics from curated topics...`);
    trendingTopicsData = await TrendingTopic.getTopTopicsForGeneration(userTopicIds, 20);
    console.log(`[Generate Suggestions] Found ${trendingTopicsData.length} trending topics from curated topics`);
  } else {
    console.log(`[Generate Suggestions] No curated topics selected, will use topics_of_interest field instead`);
  }

  job.updateProgress(20);

  // Step 3: Get sample posts from trending topics (if we have trending topics)
  let trendingPosts = [];
  if (trendingTopicsData.length > 0) {
    console.log(`[Generate Suggestions] Getting sample posts from trending topics...`);
    const allPostIds = [];

    // Collect all sample post IDs from trending topics
    for (const trendingTopic of trendingTopicsData) {
      if (trendingTopic.sample_post_ids && Array.isArray(trendingTopic.sample_post_ids)) {
        allPostIds.push(...trendingTopic.sample_post_ids);
      }
    }

    // Remove duplicates
    const uniquePostIds = [...new Set(allPostIds)];

    // Fetch the actual posts
    if (uniquePostIds.length > 0) {
      trendingPosts = await NetworkPost.query()
        .whereIn("id", uniquePostIds)
        .orderBy("engagement_score", "desc")
        .limit(20);
    }

    console.log(`[Generate Suggestions] Found ${trendingPosts.length} sample posts from trending topics`);
  }
  job.updateProgress(45);

  // Convert trending topics to the format expected by AI
  const trendingTopics = trendingTopicsData.map(t => ({
    topic: t.topic_name,
    mention_count: t.mention_count,
    total_engagement: parseFloat(t.total_engagement || 0),
    context: t.context, // Added context from AI digest
  }));

  // Get active rules for this connected account
  const rules = await Rule.getActiveRules(connectedAccount.id);
  console.log(`[Generate Suggestions] Found ${rules.length} active rules`);

  // Check if we have enough data to generate suggestions
  const hasTopicsOfInterest = connectedAccount.topics_of_interest && connectedAccount.topics_of_interest.trim().length > 0;
  const hasSamplePosts = connectedAccount.sample_posts && connectedAccount.sample_posts.length > 0;
  const hasAnyTopicSource = hasCuratedTopics || hasTopicsOfInterest;

  if (!hasAnyTopicSource && !hasSamplePosts) {
    console.log(`[Generate Suggestions] No topic sources available (need curated topics OR topics_of_interest OR sample posts)`);
    return {
      success: false,
      message: "Please add topics of interest, select curated topics, or add sample posts to generate suggestions.",
    };
  }

  // Step 4: Generate new suggestions with AI
  console.log(`[Generate Suggestions] Generating ${suggestionCount} suggestions...`);

  // Log input data for debugging
  console.log(`[Generate Suggestions] === GENERATION INPUT ===`);
  console.log(`[Generate Suggestions] Topics of Interest: ${hasTopicsOfInterest ? connectedAccount.topics_of_interest : 'none'}`);
  console.log(`[Generate Suggestions] Curated Topics Selected: ${hasCuratedTopics ? userTopicIds.length : 0}`);
  console.log(`[Generate Suggestions] Trending Topics (${trendingTopics.length}):`);
  trendingTopics.forEach((t, idx) => {
    console.log(`  [${idx}] "${t.topic}" (${t.mention_count} mentions, ${t.total_engagement} engagement)`);
  });

  console.log(`[Generate Suggestions] Trending Posts (${trendingPosts.length}):`);
  trendingPosts.forEach((p, idx) => {
    console.log(`  [${idx}] "${p.content.substring(0, 100)}..." (${p.engagement_score} engagement)`);
  });

  console.log(`[Generate Suggestions] Voice: ${connectedAccount.voice ? connectedAccount.voice.substring(0, 100) + '...' : 'none'}`);
  console.log(`[Generate Suggestions] Sample Posts: ${connectedAccount.sample_posts?.length || 0}`);
  console.log(`[Generate Suggestions] Rules: ${rules.length}`);
  console.log(`[Generate Suggestions] ========================`);

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
    topics: connectedAccount.topics_of_interest, // Add user's topics_of_interest text field
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
    rules: rules.map(r => ({
      rule_type: r.rule_type,
      content: r.content,
      priority: r.priority,
    })),
    platform: connectedAccount.platform,
    suggestionCount,
  });

  console.log(`[Generate Suggestions] === GENERATION OUTPUT ===`);
  console.log(`[Generate Suggestions] AI returned ${result.suggestions.length} suggestions:`);
  result.suggestions.forEach((s, idx) => {
    console.log(`  [${idx}] Angle: ${s.angle}, Length: ${s.length}`);
    console.log(`       Content: "${s.content.substring(0, 80)}..."`);
    console.log(`       Topics: [${s.topics?.join(', ')}]`);
    console.log(`       Inspired by posts: [${s.inspired_by_posts?.join(', ') || 'none'}]`);
  });
  console.log(`[Generate Suggestions] =========================`);

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

      // Map inspired_by_posts indices to actual network post IDs
      const inspiredByPostIds = [];
      if (suggestion.inspired_by_posts && Array.isArray(suggestion.inspired_by_posts)) {
        for (const index of suggestion.inspired_by_posts) {
          if (index >= 0 && index < trendingPosts.length) {
            inspiredByPostIds.push(trendingPosts[index].id);
          }
        }
      }

      // Build metadata with source attribution
      const metadata = {
        generation_type: "network_based",
        inspired_by_network_post_ids: inspiredByPostIds,
        trending_topics_count: trendingTopics.length,
        trending_posts_count: trendingPosts.length,
      };

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
        metadata,
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
