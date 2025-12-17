/**
 * Generate Suggestions Job
 * Generates daily post suggestions based on:
 * - User's persona (who they are, what they do)
 * - Voice profile (how they write)
 * - Content rotation system (story, hot_take, insight, etc.)
 */

import crypto from "crypto";
import { Account, ConnectedAccount, PostSuggestion, VoiceProfile, VoiceFeedback } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import { getContentTypeSequence } from "#src/config/content-types.js";
import { getTargetLength } from "#src/config/platform-lengths.js";
import { ghostQueue } from "#src/background/queues/index.js";
import { trackEvent } from "#src/helpers/track.js";
import { EVENTS } from "#src/utils/constants.js";
import { trackAICost } from "#src/helpers/track-ai-cost.js";
import { FREEMIUM_CONFIG } from "#src/config/freemium.js";

export const JOB_GENERATE_SUGGESTIONS = "generate-suggestions";
const VOICE_UPDATE_RETRY_DELAY_MS = 5000; // 5 seconds

export default async function generateSuggestions(job) {
  const { connectedAccountId, suggestionCount = 3 } = job.data;
  const startTime = Date.now();

  console.log(`[Generate Suggestions] Starting for connected account: ${connectedAccountId}`);

  try {
    // Get connected account
    const connectedAccount = await ConnectedAccount.query()
      .findById(connectedAccountId);

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
    }

    // Load account with subscriptions for limit checks
    const account = await Account.query()
      .findById(connectedAccount.account_id)
      .withGraphFetched("subscriptions");

    if (!account) {
      throw new Error(`Account ${connectedAccount.account_id} not found`);
    }

    // Check voice match threshold - AI features require 50% minimum
    if (!await connectedAccount.meetsVoiceThreshold()) {
      const voiceScore = await connectedAccount.getVoiceMatchScore();
      console.log(`[Generate Suggestions] Voice match ${voiceScore}% below ${FREEMIUM_CONFIG.VOICE_MATCH_THRESHOLD}% threshold - skipping`);
      await connectedAccount.markSuggestionsUpdateCompleted();
      return {
        success: false,
        skipped: true,
        reason: FREEMIUM_CONFIG.ERRORS.VOICE_THRESHOLD_NOT_MET,
        voice_match_score: voiceScore,
      };
    }

    // Check if free user has reached generation limit
    if (connectedAccount.hasReachedGenerationLimit(account)) {
      console.log(`[Generate Suggestions] Free user at generation limit for account ${connectedAccount.account_id} - skipping`);
      await connectedAccount.markSuggestionsUpdateCompleted();
      return {
        success: false,
        skipped: true,
        reason: FREEMIUM_CONFIG.ERRORS.GENERATION_LIMIT_REACHED,
      };
    }

    // Check for pending (delayed) voice profile job and promote it to run immediately
    const voiceJobId = `generate-voice-${connectedAccountId}`;
    const pendingVoiceJob = await ghostQueue.getJob(voiceJobId);
    if (pendingVoiceJob) {
      const state = await pendingVoiceJob.getState();
      if (state === "delayed") {
        console.log(`[Generate Suggestions] Promoting delayed voice profile job ${voiceJobId}`);
        await pendingVoiceJob.promote();
      }
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
      const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000);

      // Check if the generating profile is stale (> 15 seconds old)
      const isProfileStale = generatingProfile && new Date(generatingProfile.created_at) < fifteenSecondsAgo;
      const isFeedbackStale = pendingFeedback && new Date(pendingFeedback.created_at) < fifteenSecondsAgo;

      // Clean up any stale items
      if (isProfileStale) {
        console.log(`[Generate Suggestions] Found stale generating profile ${generatingProfile.id} - cleaning up`);
        await generatingProfile.$query().delete();
      }
      if (isFeedbackStale) {
        console.log(`[Generate Suggestions] Found stale pending feedback ${pendingFeedback.id} - marking failed`);
        await pendingFeedback.$query().patch({ status: "failed", failed_reason: "Timed out" });
      }

      // If both were stale (or didn't exist), continue. Otherwise reschedule.
      const shouldReschedule = (generatingProfile && !isProfileStale) || (pendingFeedback && !isFeedbackStale);
      if (shouldReschedule) {
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
    }

    // Get voice profile for this account
    const voiceProfile = await VoiceProfile.getCurrentProfile(connectedAccountId);
    if (voiceProfile) {
      console.log(`[Generate Suggestions] Using voice profile v${voiceProfile.version}`);
      if (voiceProfile.persona_summary) {
        console.log(`[Generate Suggestions] Persona: ${voiceProfile.persona_summary.substring(0, 100)}...`);
      }
    } else {
      console.log(`[Generate Suggestions] No voice profile found`);
    }

    // Check if we have enough context to generate (need either voice profile with persona OR bio)
    const hasBio = connectedAccount.bio && Object.values(connectedAccount.bio).some(v => v && v.trim());
    const hasPersona = voiceProfile?.persona_summary;

    if (!hasPersona && !hasBio) {
      console.log(`[Generate Suggestions] No persona or bio available - cannot generate`);
      // Clear the generating flag since we're not actually generating
      await connectedAccount.markSuggestionsUpdateCompleted();
      return {
        success: false,
        message: "Please complete your bio to generate post suggestions.",
      };
    }

    // Generate suggestions based on persona
    return await generatePersonaBasedSuggestions(job, connectedAccount, account, voiceProfile, suggestionCount, startTime);

  } catch (error) {
    console.error(`[Generate Suggestions] Error:`, error);
    throw error; // Re-throw to trigger job retry
  }
}

/**
 * Generate suggestions based on user's persona and voice
 * No topics needed - AI generates relevant content based on who they are
 */
async function generatePersonaBasedSuggestions(job, connectedAccount, account, voiceProfile, suggestionCount, startTime) {
  // Log what we're using
  console.log(`[Generate Suggestions] === GENERATION INPUT ===`);
  console.log(`[Generate Suggestions] Bio: ${connectedAccount.bio ? JSON.stringify(connectedAccount.bio) : 'none'}`);
  console.log(`[Generate Suggestions] Voice Profile: ${voiceProfile ? `v${voiceProfile.version}` : 'none'}`);
  console.log(`[Generate Suggestions] Persona: ${voiceProfile?.persona_summary || 'will derive from bio'}`);
  console.log(`[Generate Suggestions] ========================`);

  job.updateProgress(20);

  // Get next content types in rotation sequence
  const contentTypeSequence = getContentTypeSequence(connectedAccount.last_content_type, suggestionCount);
  const contentTypes = contentTypeSequence.map(ct => ct.key);
  console.log(`[Generate Suggestions] Content rotation sequence:`,
    contentTypeSequence.map(ct => `${ct.position}. ${ct.name}`).join(', ')
  );

  job.updateProgress(40);

  // Generate exactly the requested count (we'll accept fewer if AI returns less)
  console.log(`[Generate Suggestions] Generating ${suggestionCount} suggestions...`);
  let generatedSuggestions = [];

  try {
    // Use connection's preferred default length from content_preferences
    const platform = connectedAccount.platform || "ghost";
    const contentPrefs = connectedAccount.getContentPreferences();
    const defaultLength = contentPrefs.default_length || "short";
    const targetLength = getTargetLength(platform, defaultLength);
    console.log(`[Generate Suggestions] Using length: ${defaultLength} (${targetLength} chars) for platform: ${platform}`);

    // Get formatting preferences
    const formatting = {
      line_breaks: contentPrefs.line_breaks,
      emojis: contentPrefs.emojis,
    };
    console.log(`[Generate Suggestions] Formatting preferences:`, JSON.stringify(formatting));
    console.log(`[Generate Suggestions] Full content_preferences:`, JSON.stringify(contentPrefs));

    const { posts: results, usage } = await AI.generatePosts({
      voiceProfile: voiceProfile?.toPromptFormat(),
      bio: connectedAccount.bio,
      contentTypes,
      platform,
      maxLength: targetLength,
      count: suggestionCount,
      formatting,
    });

    // Track AI usage
    if (usage) {
      trackAICost(connectedAccount.account_id, {
        operation: "suggestions",
        model: usage.model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        durationMs: usage.duration_ms,
        connectedAccountId: connectedAccount.id,
        isFreeUser: !account.hasActiveSubscription(),
        metadata: {
          suggestion_count: results?.length || 0,
          platform,
          content_types: contentTypes,
        },
      });
    }

    // Map results to suggestions (accept whatever AI returns, even if fewer than requested)
    generatedSuggestions = results.map((result, i) => {
      const contentType = contentTypeSequence[i]?.key || 'story';
      return {
        content: result.content,
        content_type: contentType,
        reasoning: `Generated as "${contentTypeSequence[i]?.name || contentType}" type post based on your persona`,
        topics: [],
        angle: null,
        length: result.content.length <= 100 ? 'short' : result.content.length <= 200 ? 'medium' : 'long',
        metadata: { ...result.metadata, ai_content_type: result.content_type },
      };
    });

    console.log(`[Generate Suggestions] ✓ Generated ${generatedSuggestions.length} suggestions`);
  } catch (error) {
    console.error(`[Generate Suggestions] ✗ Generation failed:`, error.message);
    throw error;
  }

  job.updateProgress(70);

  // Generate batch ID to group these suggestions together
  const batchId = crypto.randomUUID();

  // Save suggestions to database
  const savedCount = await saveSuggestions(connectedAccount, generatedSuggestions, batchId, {
    generation_type: "persona_based",
    voice_profile_version: voiceProfile?.version || null,
    has_persona: !!voiceProfile?.persona_summary,
  });

  // Increment generated posts counter for free users (each suggestion counts as 1 post)
  if (savedCount > 0 && !account.hasActiveSubscription()) {
    const newCount = await connectedAccount.incrementGeneratedPosts(savedCount);
    console.log(`[Generate Suggestions] Incremented generated posts count to ${newCount}`);
  }

  // Clear the suggestions update started timestamp
  await connectedAccount.markSuggestionsUpdateCompleted();

  job.updateProgress(100);

  // Send push notification if automated
  if (job.data.automated && savedCount > 0) {
    await sendPushNotification(connectedAccount, savedCount);
  }

  // Track suggestions generated
  const durationSeconds = (Date.now() - startTime) / 1000;
  trackEvent(connectedAccount.account_id, EVENTS.SUGGESTIONS_GENERATED, {
    connected_account_id: connectedAccount.id,
    platform: connectedAccount.platform,
    suggestion_count: savedCount,
    batch_id: batchId,
    voice_profile_version: voiceProfile?.version || null,
    automated: !!job.data.automated,
    duration_seconds: durationSeconds,
  });

  return {
    success: true,
    suggestions_generated: savedCount,
    batch_id: batchId,
    generation_type: "persona_based",
    voice_profile_version: voiceProfile?.version || null,
    completed_at: new Date().toISOString(),
  };
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
