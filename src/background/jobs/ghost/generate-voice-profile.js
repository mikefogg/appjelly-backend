/**
 * Generate Voice Profile Job
 * Creates a comprehensive voice profile from sample posts and rules
 * Triggered when samples/rules change, or user requests regeneration
 */

import { Account, ConnectedAccount, SamplePost, Rule, VoiceProfile, VoiceFeedback, PostSuggestion } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import crypto from "crypto";
import { ghostQueue, JOB_GENERATE_SUGGESTIONS } from "#src/background/queues/index.js";
import { trackEvent } from "#src/helpers/track.js";
import { trackAICost } from "#src/helpers/track-ai-cost.js";
import { FREEMIUM_CONFIG } from "#src/config/freemium.js";
import { EVENTS } from "#src/utils/constants.js";

export const JOB_GENERATE_VOICE_PROFILE = "generate-voice-profile";

/**
 * Generate a hash of inputs to detect when regeneration is needed
 */
function generateInputHash(samplePosts, rules) {
  const data = JSON.stringify({
    samples: samplePosts.map((p) => ({ content: p.content, notes: p.notes })),
    rules: rules.map((r) => ({ type: r.rule_type, content: r.content })),
  });
  return crypto.createHash("sha256").update(data).digest("hex").substring(0, 16);
}

export default async function generateVoiceProfile(job) {
  const { connectedAccountId, feedback, force } = job.data;
  const startTime = Date.now();

  console.log(`[Generate Voice Profile] Starting for account: ${connectedAccountId}`);

  try {
    // Get connected account
    const connectedAccount = await ConnectedAccount.query().findById(connectedAccountId);

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
    }

    // Mark voice update as started now that job is actually processing
    await connectedAccount.markVoiceUpdateStarted();

    // Load account with subscriptions for limit checks
    const account = await Account.query()
      .findById(connectedAccount.account_id)
      .withGraphFetched("subscriptions");

    if (!account) {
      throw new Error(`Account ${connectedAccount.account_id} not found`);
    }

    // Check if free user has reached generation limit (skip if force/subscription_activated/admin)
    // When at limit, we stop updating voice profiles until they subscribe
    const reason = job.data.reason;
    if (reason !== "subscription_activated" && reason !== "admin" && connectedAccount.hasReachedGenerationLimit(account)) {
      console.log(`[Generate Voice Profile] Free user at generation limit for account ${connectedAccount.account_id} - skipping`);
      await connectedAccount.markVoiceUpdateCompleted(); // Clear the flag
      return {
        success: false,
        skipped: true,
        reason: FREEMIUM_CONFIG.ERRORS.GENERATION_LIMIT_REACHED,
      };
    }

    // Check if there's already a profile being generated
    const generating = await VoiceProfile.getGeneratingProfile(connectedAccountId);
    if (generating) {
      console.log(`[Generate Voice Profile] Already generating profile ${generating.id}, skipping`);
      return {
        success: false,
        skipped: true,
        reason: "Profile generation already in progress",
      };
    }

    // Fetch sample posts, rules, pending feedback, and processed feedback
    const [samplePosts, rules, pendingFeedback, processedFeedback] = await Promise.all([
      SamplePost.query()
        .where("connected_account_id", connectedAccountId)
        .orderBy("sort_order", "asc"),
      Rule.getActiveRules(connectedAccountId),
      VoiceFeedback.query()
        .where("connected_account_id", connectedAccountId)
        .where("status", "pending")
        .orderBy("created_at", "asc"),
      // Also fetch processed feedback to preserve learnings during full regeneration
      VoiceFeedback.query()
        .where("connected_account_id", connectedAccountId)
        .where("status", "processed")
        .orderBy("created_at", "asc"),
    ]);

    // Get topics and bio from connected account for context
    const topics = connectedAccount.topics_of_interest;
    const bio = connectedAccount.bio;

    console.log(`[Generate Voice Profile] Found ${samplePosts.length} samples, ${rules.length} rules, ${pendingFeedback.length} pending feedback, ${processedFeedback.length} processed feedback, topics: ${topics ? "yes" : "no"}, bio: ${bio && Object.keys(bio).length > 0 ? "yes" : "no"}`);

    // Check if voice match score meets threshold before generating
    const preCheckScore = await connectedAccount.getVoiceMatchScore();
    if (preCheckScore < FREEMIUM_CONFIG.VOICE_MATCH_THRESHOLD) {
      console.log(`[Generate Voice Profile] Voice match ${preCheckScore}% < ${FREEMIUM_CONFIG.VOICE_MATCH_THRESHOLD}% threshold - skipping`);
      await connectedAccount.markVoiceUpdateCompleted(); // Clear the flag
      return {
        success: false,
        skipped: true,
        reason: `Voice match score (${preCheckScore}%) is below ${FREEMIUM_CONFIG.VOICE_MATCH_THRESHOLD}% threshold. Add more samples, rules, or complete your bio.`,
        voice_match_score: preCheckScore,
      };
    }

    // Generate input hash
    const inputHash = generateInputHash(samplePosts, rules);

    // Check if current profile has same hash (no changes) - skip if force or feedback provided
    if (!feedback && !force) {
      const currentProfile = await VoiceProfile.getCurrentProfile(connectedAccountId);
      if (currentProfile && currentProfile.input_hash === inputHash) {
        console.log(`[Generate Voice Profile] No changes detected, skipping regeneration`);
        await connectedAccount.markVoiceUpdateCompleted(); // Clear the flag
        return {
          success: true,
          skipped: true,
          reason: "No changes to samples or rules",
          current_version: currentProfile.version,
        };
      }
    }

    // Create new profile in "generating" status
    const newProfile = await VoiceProfile.createGenerating(connectedAccountId, inputHash);
    console.log(`[Generate Voice Profile] Created profile v${newProfile.version} (${newProfile.id})`);

    job.updateProgress(20);

    // Combine all feedback sources:
    // 1. Job-provided feedback (from direct call)
    // 2. Pending feedback (not yet processed)
    // 3. Processed feedback (critical: preserves learnings during full regeneration)
    const allFeedback = [
      ...(feedback ? [feedback] : []),
      ...pendingFeedback.map(f => f.feedback),
      // Include processed feedback to preserve learnings when hash changes trigger regeneration
      ...processedFeedback.map(f => f.feedback),
    ].join("\n");

    if (processedFeedback.length > 0) {
      console.log(`[Generate Voice Profile] Including ${processedFeedback.length} processed feedback items to preserve learnings`);
    }

    // Get formatting preferences for examples
    const contentPrefs = connectedAccount.getContentPreferences();
    const formatting = {
      line_breaks: contentPrefs.line_breaks,
      emojis: contentPrefs.emojis,
    };
    console.log(`[Generate Voice Profile] Formatting preferences:`, JSON.stringify(formatting));

    // Generate voice profile with AI
    console.log(`[Generate Voice Profile] Calling AI.generateVoiceProfile...`);
    const profileData = await AI.generateVoiceProfile({
      samplePosts: samplePosts.map((p) => ({ content: p.content, notes: p.notes })),
      rules: rules.map((r) => ({ rule_type: r.rule_type, content: r.content })),
      feedback: allFeedback || null,
      topics, // Pass topics for starter profile if no samples
      bio, // Pass bio for context in voice analysis
      formatting, // Pass formatting for example generation
    });

    // Track AI usage - each call separately
    if (profileData.usages) {
      for (const usage of profileData.usages) {
        trackAICost(connectedAccount.account_id, {
          operation: usage.operation,
          model: usage.model,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          durationMs: usage.duration_ms,
          connectedAccountId: connectedAccount.id,
          isFreeUser: !account.hasActiveSubscription(),
          metadata: {
            sample_posts_count: samplePosts.length,
            rules_count: rules.length,
            has_feedback: !!allFeedback,
            confidence: profileData.confidence,
          },
        });
      }
    }

    job.updateProgress(80);

    // Update profile with generated data and mark as active
    // Use formula-based voice match score, not AI's confidence
    await newProfile.$query().patch({
      status: "active",
      voice_summary: profileData.voice_summary,
      persona_summary: profileData.persona_summary,
      sentence_patterns: profileData.sentence_patterns,
      vocabulary_notes: profileData.vocabulary_notes,
      tone_markers: profileData.tone_markers,
      formatting_habits: profileData.formatting_habits,
      hard_rules: profileData.hard_rules,
      examples: profileData.examples,
      confidence: preCheckScore / 100, // Normalized 0-1 for storage
      confidence_reasoning: profileData.confidence_reasoning,
    });

    if (profileData.persona_summary) {
      console.log(`[Generate Voice Profile] Persona: ${profileData.persona_summary.substring(0, 100)}...`);
    }

    // Check if user has ANY suggestions ever - if not, generate some immediately
    const existingSuggestions = await PostSuggestion.query()
      .where("connected_account_id", connectedAccountId)
      .count("id as count")
      .first();

    const suggestionCount = parseInt(existingSuggestions?.count || 0, 10);
    if (suggestionCount === 0) {
      console.log(`[Generate Voice Profile] No suggestions exist - queueing initial generation`);
      await connectedAccount.markSuggestionsUpdateStarted();
      await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, {
        connectedAccountId,
        suggestionCount: 3,
      }, {
        jobId: `gen-suggestions-${connectedAccountId}`,
      });
    } else {
      console.log(`[Generate Voice Profile] User has ${suggestionCount} suggestions - skipping auto-generation`);
    }

    // Mark any pending feedback as processed
    if (pendingFeedback.length > 0) {
      await VoiceFeedback.query()
        .whereIn("id", pendingFeedback.map(f => f.id))
        .patch({ status: "processed", processed_at: new Date().toISOString() });
      console.log(`[Generate Voice Profile] Marked ${pendingFeedback.length} pending feedback as processed`);
    }

    // Clear the voice update started timestamp
    await connectedAccount.markVoiceUpdateCompleted();

    job.updateProgress(100);

    console.log(
      `[Generate Voice Profile] ✅ Profile v${newProfile.version} active ` +
        `(voice match: ${preCheckScore}%)`
    );

    // Track voice profile generation
    const durationSeconds = (Date.now() - startTime) / 1000;
    trackEvent(connectedAccount.account_id, EVENTS.VOICE_PROFILE_GENERATED, {
      connected_account_id: connectedAccountId,
      platform: connectedAccount.platform,
      profile_id: newProfile.id,
      version: newProfile.version,
      confidence: preCheckScore / 100, // Normalize to 0-1 for consistency
      sample_count: samplePosts.length,
      rule_count: rules.length,
      feedback_processed: pendingFeedback.length,
      forced: !!force,
      duration_seconds: durationSeconds,
    });

    return {
      success: true,
      profile_id: newProfile.id,
      version: newProfile.version,
      confidence: preCheckScore / 100, // Normalized 0-1
      voice_match_score: preCheckScore, // Percentage 0-100
      sample_count: samplePosts.length,
      rule_count: rules.length,
      pending_feedback_processed: pendingFeedback.length,
    };
  } catch (error) {
    console.error(`[Generate Voice Profile] Error:`, error);

    // Clean up any "generating" profile on failure
    try {
      const generating = await VoiceProfile.getGeneratingProfile(connectedAccountId);
      if (generating) {
        await generating.$query().delete();
        console.log(`[Generate Voice Profile] Cleaned up failed profile ${generating.id}`);
      }
    } catch (cleanupError) {
      console.error(`[Generate Voice Profile] Cleanup error:`, cleanupError);
    }

    throw error;
  }
}
