/**
 * Generate Suggestions Job
 * Generates daily post suggestions based on:
 * - User's persona (who they are, what they do)
 * - Voice profile (how they write)
 * - Content rotation system (story, hot_take, insight, etc.)
 */

import crypto from "crypto";
import { ConnectedAccount, PostSuggestion, VoiceProfile, VoiceFeedback, Subscription } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import { getContentTypeSequence } from "#src/config/content-types.js";
import { getTargetLength } from "#src/config/platform-lengths.js";
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
      await connectedAccount.markSuggestionsUpdateCompleted();
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
      // Don't clear the flag - we're rescheduling, not skipping
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
    return await generatePersonaBasedSuggestions(job, connectedAccount, voiceProfile, suggestionCount);

  } catch (error) {
    console.error(`[Generate Suggestions] Error:`, error);
    throw error; // Re-throw to trigger job retry
  }
}

/**
 * Generate suggestions based on user's persona and voice
 * No topics needed - AI generates relevant content based on who they are
 */
async function generatePersonaBasedSuggestions(job, connectedAccount, voiceProfile, suggestionCount) {
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

    const results = await AI.generatePosts({
      voiceProfile: voiceProfile?.toPromptFormat(),
      bio: connectedAccount.bio,
      contentTypes,
      platform,
      maxLength: targetLength,
      count: suggestionCount,
      formatting,
    });

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

  // Clear the suggestions update started timestamp
  await connectedAccount.markSuggestionsUpdateCompleted();

  job.updateProgress(100);

  // Send push notification if automated
  if (job.data.automated && savedCount > 0) {
    await sendPushNotification(connectedAccount, savedCount);
  }

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
