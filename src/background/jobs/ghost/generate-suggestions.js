/**
 * Generate Suggestions Job
 * Generates daily post suggestions based on:
 * - Network activity (for Twitter, LinkedIn, etc.)
 * - Topics of interest (for Ghost platform)
 * - Content rotation system (story, lesson, question, etc.)
 */

import crypto from "crypto";
import { ConnectedAccount, NetworkPost, PostSuggestion, UserTopicPreference, TrendingTopic, VoiceProfile, VoiceFeedback, Subscription } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import { getContentTypeSequence } from "#src/config/content-types.js";
import { ghostQueue } from "#src/background/queues/index.js";

export const JOB_GENERATE_SUGGESTIONS = "generate-suggestions";
const VOICE_UPDATE_RETRY_DELAY_MS = 10000; // 10 seconds

export default async function generateSuggestions(job) {
  const { connectedAccountId, suggestionCount = 3 } = job.data;

  console.log(`[Generate Suggestions] Starting for connected account: ${connectedAccountId}`);

  try {
    // Get connected account
    const connectedAccount = await ConnectedAccount.query()
      .findById(connectedAccountId);

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
    }

    // Check for active subscription
    const activeSubscription = await Subscription.findActiveByAccount(connectedAccount.account_id);
    if (!activeSubscription) {
      console.log(`[Generate Suggestions] No active subscription for account ${connectedAccount.account_id} - skipping`);
      return {
        success: false,
        skipped: true,
        reason: "No active subscription",
      };
    }

    // Check if voice profile is being updated - if so, delay this job
    const [generatingProfile, pendingFeedback] = await Promise.all([
      VoiceProfile.getGeneratingProfile(connectedAccountId),
      VoiceFeedback.query()
        .where("connected_account_id", connectedAccountId)
        .whereIn("status", ["pending", "processing"])
        .first(),
    ]);

    if (generatingProfile || pendingFeedback) {
      console.log(`[Generate Suggestions] Voice update in progress, rescheduling in ${VOICE_UPDATE_RETRY_DELAY_MS}ms`);
      await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, job.data, {
        delay: VOICE_UPDATE_RETRY_DELAY_MS,
      });
      return {
        success: true,
        delayed: true,
        reason: "Voice update in progress - rescheduled",
      };
    }

    // Get voice profile for this account
    const voiceProfile = await VoiceProfile.getCurrentProfile(connectedAccountId);
    if (voiceProfile) {
      console.log(`[Generate Suggestions] Using voice profile v${voiceProfile.version}`);
    } else {
      console.log(`[Generate Suggestions] No voice profile found`);
    }

    // Branch logic based on platform type
    const isGhostPlatform = connectedAccount.platform === "ghost";

    if (isGhostPlatform) {
      console.log(`[Generate Suggestions] Ghost platform - using interest-based generation`);
      return await generateInterestBasedSuggestions(job, connectedAccount, voiceProfile, suggestionCount);
    } else {
      console.log(`[Generate Suggestions] Network platform - using network-based generation`);
      return await generateNetworkBasedSuggestions(job, connectedAccount, voiceProfile, suggestionCount);
    }

  } catch (error) {
    console.error(`[Generate Suggestions] Error:`, error);
    throw error; // Re-throw to trigger job retry
  }
}

/**
 * Generate suggestions for ghost platform based on topics of interest
 */
async function generateInterestBasedSuggestions(job, connectedAccount, voiceProfile, suggestionCount) {
  let { topics_of_interest } = connectedAccount;

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

  // Step 3: Check topic sources (curated or custom text)
  const hasCustomTopics = topics_of_interest && topics_of_interest.trim().length > 0;
  const hasAnyTopicSource = hasCuratedTopics || hasCustomTopics;

  // Verify we have at least one topic source
  if (!hasAnyTopicSource) {
    console.log(`[Generate Suggestions] No topic sources available (need curated topics OR topics_of_interest)`);
    return {
      success: false,
      message: "Please select curated topics or add topics of interest to generate suggestions.",
    };
  }

  // Log what we're using
  console.log(`[Generate Suggestions] === GENERATION INPUT ===`);
  console.log(`[Generate Suggestions] Curated Topics Selected: ${hasCuratedTopics ? userTopicIds.length : 0}`);
  console.log(`[Generate Suggestions] Custom Topics of Interest: ${hasCustomTopics ? topics_of_interest : 'none'}`);
  console.log(`[Generate Suggestions] Trending Topics (${trendingTopics.length}):`);
  trendingTopics.slice(0, 5).forEach((t, idx) => {
    console.log(`  [${idx}] "${t.topic}" (${t.mention_count} mentions)`);
  });
  console.log(`[Generate Suggestions] Voice Profile: ${voiceProfile ? `v${voiceProfile.version}` : 'none'}`);
  console.log(`[Generate Suggestions] ========================`);

  job.updateProgress(40);

  // Get next content types in rotation sequence
  const contentTypeSequence = getContentTypeSequence(connectedAccount.last_content_type, suggestionCount);
  const contentTypes = contentTypeSequence.map(ct => ct.key);
  console.log(`[Generate Suggestions] Content rotation sequence:`,
    contentTypeSequence.map(ct => `${ct.position}. ${ct.name}`).join(', ')
  );

  // Build topic string for generation
  const topicString = buildTopicString(topics_of_interest, trendingTopics);

  // Generate all suggestions in a single batch AI call
  console.log(`[Generate Suggestions] Generating ${suggestionCount} suggestions in batch...`);
  let generatedSuggestions = [];

  try {
    const results = await AI.generatePosts({
      topic: topicString,
      voiceProfile: voiceProfile?.toPromptFormat(),
      contentTypes,
      platform: connectedAccount.platform,
      maxLength: 280,
    });

    generatedSuggestions = results.map((result, i) => ({
      content: result.content,
      content_type: result.content_type,
      reasoning: `Generated as "${contentTypeSequence[i]?.name || result.content_type}" type post`,
      topics: trendingTopics.slice(0, 3).map(t => t.topic),
      angle: null,
      length: result.content.length <= 100 ? 'short' : result.content.length <= 200 ? 'medium' : 'long',
      metadata: result.metadata,
    }));

    console.log(`[Generate Suggestions] ✓ Batch generated ${generatedSuggestions.length} suggestions`);
  } catch (error) {
    console.error(`[Generate Suggestions] ✗ Batch generation failed:`, error.message);
  }

  console.log(`[Generate Suggestions] Generated ${generatedSuggestions.length} suggestions`);
  job.updateProgress(70);

  // Generate batch ID to group these suggestions together
  const batchId = crypto.randomUUID();

  // Save suggestions to database
  const savedCount = await saveSuggestions(connectedAccount, generatedSuggestions, batchId, {
    generation_type: "interest_based_rotation",
    had_curated_topics: hasCuratedTopics,
    curated_topics_count: userTopicIds.length,
    trending_topics_count: trendingTopics.length,
    topics_of_interest,
    voice_profile_version: voiceProfile?.version || null,
  });

  job.updateProgress(100);

  // Send push notification if automated
  if (job.data.automated && savedCount > 0) {
    await sendPushNotification(connectedAccount, savedCount);
  }

  return {
    success: true,
    suggestions_generated: savedCount,
    batch_id: batchId,
    generation_type: "interest_based",
    curated_topics_count: userTopicIds.length,
    trending_topics_count: trendingTopics.length,
    completed_at: new Date().toISOString(),
  };
}

/**
 * Generate suggestions based on network activity
 */
async function generateNetworkBasedSuggestions(job, connectedAccount, voiceProfile, suggestionCount) {
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
  }

  job.updateProgress(20);

  // Step 3: Get sample posts from trending topics (if we have trending topics)
  let trendingPosts = [];
  if (trendingTopicsData.length > 0) {
    console.log(`[Generate Suggestions] Getting sample posts from trending topics...`);
    const allPostIds = [];

    for (const trendingTopic of trendingTopicsData) {
      if (trendingTopic.sample_post_ids && Array.isArray(trendingTopic.sample_post_ids)) {
        allPostIds.push(...trendingTopic.sample_post_ids);
      }
    }

    const uniquePostIds = [...new Set(allPostIds)];

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
    context: t.context,
  }));

  // Check if we have enough data to generate suggestions
  const hasTopicsOfInterest = connectedAccount.topics_of_interest && connectedAccount.topics_of_interest.trim().length > 0;
  const hasAnyTopicSource = hasCuratedTopics || hasTopicsOfInterest;

  if (!hasAnyTopicSource) {
    console.log(`[Generate Suggestions] No topic sources available`);
    return {
      success: false,
      message: "Please add topics of interest or select curated topics to generate suggestions.",
    };
  }

  // Log input data for debugging
  console.log(`[Generate Suggestions] === GENERATION INPUT ===`);
  console.log(`[Generate Suggestions] Topics of Interest: ${hasTopicsOfInterest ? connectedAccount.topics_of_interest : 'none'}`);
  console.log(`[Generate Suggestions] Curated Topics Selected: ${hasCuratedTopics ? userTopicIds.length : 0}`);
  console.log(`[Generate Suggestions] Trending Topics: ${trendingTopics.length}`);
  console.log(`[Generate Suggestions] Trending Posts: ${trendingPosts.length}`);
  console.log(`[Generate Suggestions] Voice Profile: ${voiceProfile ? `v${voiceProfile.version}` : 'none'}`);
  console.log(`[Generate Suggestions] ========================`);

  // Get next content types in rotation sequence
  const contentTypeSequence = getContentTypeSequence(connectedAccount.last_content_type, suggestionCount);
  const contentTypes = contentTypeSequence.map(ct => ct.key);
  console.log(`[Generate Suggestions] Content rotation sequence:`,
    contentTypeSequence.map(ct => `${ct.position}. ${ct.name}`).join(', ')
  );

  // Build topic string for generation
  const topicString = buildTopicString(connectedAccount.topics_of_interest, trendingTopics);

  // Generate all suggestions in a single batch AI call
  console.log(`[Generate Suggestions] Generating ${suggestionCount} suggestions in batch...`);
  let generatedSuggestions = [];

  try {
    const results = await AI.generatePosts({
      topic: topicString,
      voiceProfile: voiceProfile?.toPromptFormat(),
      contentTypes,
      platform: connectedAccount.platform,
      maxLength: 280,
    });

    generatedSuggestions = results.map((result, i) => ({
      content: result.content,
      content_type: result.content_type,
      reasoning: `Generated as "${contentTypeSequence[i]?.name || result.content_type}" type post`,
      topics: trendingTopics.slice(0, 3).map(t => t.topic),
      angle: null,
      length: result.content.length <= 100 ? 'short' : result.content.length <= 200 ? 'medium' : 'long',
      metadata: result.metadata,
    }));

    console.log(`[Generate Suggestions] ✓ Batch generated ${generatedSuggestions.length} suggestions`);
  } catch (error) {
    console.error(`[Generate Suggestions] ✗ Batch generation failed:`, error.message);
  }

  console.log(`[Generate Suggestions] Generated ${generatedSuggestions.length} suggestions`);
  job.updateProgress(70);

  // Generate batch ID to group these suggestions together
  const batchId = crypto.randomUUID();

  // Save suggestions to database
  const savedCount = await saveSuggestions(connectedAccount, generatedSuggestions, batchId, {
    generation_type: "network_based_rotation",
    trending_topics_count: trendingTopics.length,
    trending_posts_count: trendingPosts.length,
  });

  job.updateProgress(100);

  // Send push notification if automated
  if (job.data.automated && savedCount > 0) {
    await sendPushNotification(connectedAccount, savedCount);
  }

  return {
    success: true,
    suggestions_generated: savedCount,
    batch_id: batchId,
    generation_type: "network_based",
    trending_topics: trendingTopics.length,
    trending_posts: trendingPosts.length,
    completed_at: new Date().toISOString(),
  };
}

/**
 * Build topic string from topics_of_interest and trending topics
 */
function buildTopicString(topicsOfInterest, trendingTopics) {
  let topicString = '';

  if (topicsOfInterest && topicsOfInterest.trim().length > 0) {
    topicString = topicsOfInterest;
  }

  if (trendingTopics && trendingTopics.length > 0) {
    const trendingStr = trendingTopics.slice(0, 5).map(t => {
      return t.context ? `${t.topic} (${t.context})` : t.topic;
    }).join('; ');

    if (topicString) {
      topicString += `\n\nTrending now: ${trendingStr}`;
    } else {
      topicString = trendingStr;
    }
  }

  return topicString || "general thoughts and observations";
}

/**
 * Save suggestions to database
 */
async function saveSuggestions(connectedAccount, suggestions, batchId, baseMetadata) {
  console.log(`[Generate Suggestions] Saving ${suggestions.length} suggestions with batch_id: ${batchId}...`);
  let savedCount = 0;

  for (const suggestion of suggestions) {
    try {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      const metadata = {
        ...baseMetadata,
        content_type: suggestion.content_type,
        ai_metadata: suggestion.metadata,
      };

      await PostSuggestion.query().insert({
        account_id: connectedAccount.account_id,
        connected_account_id: connectedAccount.id,
        app_id: connectedAccount.app_id,
        suggestion_type: "original_post",
        content: suggestion.content,
        content_type: suggestion.content_type,
        reasoning: suggestion.reasoning,
        source_post_id: null,
        topics: suggestion.topics || [],
        angle: suggestion.angle,
        length: suggestion.length,
        character_count: suggestion.content.length,
        expires_at: expiresAt.toISOString(),
        status: "pending",
        batch_id: batchId,
        metadata,
      });

      savedCount++;
    } catch (error) {
      console.warn(`Failed to save suggestion:`, error.message);
    }
  }

  console.log(`[Generate Suggestions] Saved ${savedCount} suggestions`);
  return savedCount;
}

/**
 * Send push notification for new suggestions
 */
async function sendPushNotification(connectedAccount, savedCount) {
  try {
    const { ghostQueue, JOB_SEND_PUSH_NOTIFICATION } = await import("#src/background/queues/index.js");

    await ghostQueue.add(JOB_SEND_PUSH_NOTIFICATION, {
      account_id: connectedAccount.account_id,
      notification: {
        heading: "Your daily posts are ready!",
        content: `We've generated ${savedCount} fresh post ideas for you.`,
        data: {
          type: "suggestions_ready",
          connected_account_id: connectedAccount.id,
          suggestion_count: savedCount,
        },
      },
    });

    console.log(`[Generate Suggestions] Queued push notification for ${savedCount} suggestions`);
  } catch (error) {
    console.warn(`[Generate Suggestions] Failed to queue push notification:`, error.message);
  }
}
