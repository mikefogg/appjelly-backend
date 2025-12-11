/**
 * Generate Voice Profile Job
 * Creates a comprehensive voice profile from sample posts and rules
 * Triggered when samples/rules change, or user requests regeneration
 */

import { ConnectedAccount, SamplePost, Rule, VoiceProfile, VoiceFeedback, Subscription } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import crypto from "crypto";

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

  console.log(`[Generate Voice Profile] Starting for account: ${connectedAccountId}`);

  try {
    // Get connected account
    const connectedAccount = await ConnectedAccount.query().findById(connectedAccountId);

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
    }

    // Check for active subscription
    const activeSubscription = await Subscription.findActiveByAccount(connectedAccount.account_id);
    if (!activeSubscription) {
      console.log(`[Generate Voice Profile] No active subscription for account ${connectedAccount.account_id} - skipping`);
      return {
        success: false,
        skipped: true,
        reason: "No active subscription",
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

    // Fetch sample posts, rules, and any pending feedback
    const [samplePosts, rules, pendingFeedback] = await Promise.all([
      SamplePost.query()
        .where("connected_account_id", connectedAccountId)
        .orderBy("sort_order", "asc"),
      Rule.getActiveRules(connectedAccountId),
      VoiceFeedback.query()
        .where("connected_account_id", connectedAccountId)
        .where("status", "pending")
        .orderBy("created_at", "asc"),
    ]);

    // Get topics and bio from connected account for starter profile if no samples
    const topics = connectedAccount.topics_of_interest;
    const bio = connectedAccount.bio;

    console.log(`[Generate Voice Profile] Found ${samplePosts.length} samples, ${rules.length} rules, ${pendingFeedback.length} pending feedback, topics: ${topics ? "yes" : "no"}, bio: ${bio && Object.keys(bio).length > 0 ? "yes" : "no"}`);

    // Generate input hash
    const inputHash = generateInputHash(samplePosts, rules);

    // Check if current profile has same hash (no changes) - skip if force or feedback provided
    if (!feedback && !force) {
      const currentProfile = await VoiceProfile.getCurrentProfile(connectedAccountId);
      if (currentProfile && currentProfile.input_hash === inputHash) {
        console.log(`[Generate Voice Profile] No changes detected, skipping regeneration`);
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

    // Combine job feedback with any pending feedback from database
    const allFeedback = [
      ...(feedback ? [feedback] : []),
      ...pendingFeedback.map(f => f.feedback),
    ].join("\n");

    // Generate voice profile with AI
    console.log(`[Generate Voice Profile] Calling AI.generateVoiceProfile...`);
    const profileData = await AI.generateVoiceProfile({
      samplePosts: samplePosts.map((p) => ({ content: p.content, notes: p.notes })),
      rules: rules.map((r) => ({ rule_type: r.rule_type, content: r.content })),
      feedback: allFeedback || null,
      topics, // Pass topics for starter profile if no samples
      bio, // Pass bio for context in voice analysis
    });

    job.updateProgress(80);

    // Update profile with generated data and mark as active
    await newProfile.$query().patch({
      status: "active",
      voice_summary: profileData.voice_summary,
      sentence_patterns: profileData.sentence_patterns,
      vocabulary_notes: profileData.vocabulary_notes,
      tone_markers: profileData.tone_markers,
      formatting_habits: profileData.formatting_habits,
      hard_rules: profileData.hard_rules,
      examples: profileData.examples,
      confidence: profileData.confidence,
      confidence_reasoning: profileData.confidence_reasoning,
    });

    // Mark any pending feedback as processed
    if (pendingFeedback.length > 0) {
      await VoiceFeedback.query()
        .whereIn("id", pendingFeedback.map(f => f.id))
        .patch({ status: "processed", processed_at: new Date().toISOString() });
      console.log(`[Generate Voice Profile] Marked ${pendingFeedback.length} pending feedback as processed`);
    }

    job.updateProgress(100);

    console.log(
      `[Generate Voice Profile] ✅ Profile v${newProfile.version} active ` +
        `(confidence: ${(profileData.confidence * 100).toFixed(0)}%)`
    );

    return {
      success: true,
      profile_id: newProfile.id,
      version: newProfile.version,
      confidence: profileData.confidence,
      confidence_reasoning: profileData.confidence_reasoning,
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
