/**
 * Process Voice Feedback Job
 * Takes user feedback and updates the voice profile accordingly
 */

import { Account, VoiceFeedback, VoiceProfile, SamplePost, ConnectedAccount } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import { ghostQueue, JOB_GENERATE_VOICE_PROFILE } from "#src/background/queues/index.js";
import { FREEMIUM_CONFIG } from "#src/config/freemium.js";

export const JOB_PROCESS_VOICE_FEEDBACK = "process-voice-feedback";

export default async function processVoiceFeedback(job) {
  const { feedbackId } = job.data;

  console.log(`[Process Voice Feedback] Starting for feedback: ${feedbackId}`);

  try {
    // Get feedback record
    const feedback = await VoiceFeedback.query().findById(feedbackId);

    if (!feedback) {
      throw new Error(`Feedback ${feedbackId} not found`);
    }

    if (feedback.status !== "pending") {
      console.log(`[Process Voice Feedback] Feedback already ${feedback.status}, skipping`);
      return {
        success: false,
        skipped: true,
        reason: `Feedback already ${feedback.status}`,
      };
    }

    const connectedAccount = await ConnectedAccount.query().findById(feedback.connected_account_id);
    if (!connectedAccount) {
      throw new Error(`Connected account ${feedback.connected_account_id} not found`);
    }

    // Load account for limit checks
    const account = await Account.query()
      .findById(connectedAccount.account_id)
      .withGraphFetched("subscriptions");

    if (!account) {
      throw new Error(`Account ${connectedAccount.account_id} not found`);
    }

    // Check voice match threshold before processing
    const voiceMatchScore = await connectedAccount.getVoiceMatchScore();
    if (voiceMatchScore < FREEMIUM_CONFIG.VOICE_MATCH_THRESHOLD) {
      console.log(`[Process Voice Feedback] Voice match ${voiceMatchScore}% < ${FREEMIUM_CONFIG.VOICE_MATCH_THRESHOLD}% threshold - skipping`);
      await feedback.markFailed(`Voice match score (${voiceMatchScore}%) below threshold`);
      return {
        success: false,
        skipped: true,
        reason: `Voice match score (${voiceMatchScore}%) is below ${FREEMIUM_CONFIG.VOICE_MATCH_THRESHOLD}% threshold`,
        voice_match_score: voiceMatchScore,
      };
    }

    // Check if free user has reached generation limit
    if (connectedAccount.hasReachedGenerationLimit(account)) {
      console.log(`[Process Voice Feedback] Free user at generation limit for account ${account.id} - skipping`);
      await feedback.markFailed(FREEMIUM_CONFIG.ERRORS.GENERATION_LIMIT_REACHED);
      return {
        success: false,
        skipped: true,
        reason: FREEMIUM_CONFIG.ERRORS.GENERATION_LIMIT_REACHED,
      };
    }

    // Mark as processing
    await feedback.markProcessing();
    await connectedAccount.markVoiceUpdateStarted();
    job.updateProgress(10);

    // Get current voice profile
    const currentProfile = await VoiceProfile.getCurrentProfile(feedback.connected_account_id);

    if (!currentProfile) {
      // No existing profile - trigger voice generation (it will pick up this pending feedback)
      // The generate-voice-profile job will handle the voice update flag
      console.log(`[Process Voice Feedback] No voice profile exists, triggering generation`);
      await feedback.$query().patch({ status: "pending" });

      await ghostQueue.add(JOB_GENERATE_VOICE_PROFILE, {
        connectedAccountId: feedback.connected_account_id,
      });

      return {
        success: true,
        triggered_generation: true,
        reason: "No voice profile yet - triggered generation with feedback",
      };
    }

    // Get sample posts (ground truth for the AI)
    const samplePosts = await SamplePost.query()
      .where("connected_account_id", feedback.connected_account_id)
      .orderBy("sort_order", "asc")
      .orderBy("created_at", "asc");

    console.log(`[Process Voice Feedback] Current profile v${currentProfile.version}`);
    console.log(`[Process Voice Feedback] Sample posts: ${samplePosts.length}`);
    console.log(`[Process Voice Feedback] Feedback: "${feedback.feedback}"`);
    if (feedback.reference_text) {
      console.log(`[Process Voice Feedback] Reference: "${feedback.reference_text.substring(0, 50)}..."`);
    }

    // Create new profile in "generating" status first
    const newProfile = await VoiceProfile.createGenerating(
      feedback.connected_account_id,
      currentProfile.input_hash // Keep same input hash (samples/rules didn't change)
    );
    console.log(`[Process Voice Feedback] Created profile v${newProfile.version} (generating)`);

    job.updateProgress(20);

    // Apply feedback via AI (with sample posts as ground truth)
    console.log(`[Process Voice Feedback] Calling AI.applyVoiceFeedback...`);
    const updatedProfile = await AI.applyVoiceFeedback({
      currentProfile: currentProfile.toPromptFormat(),
      samplePosts,
      feedback: feedback.feedback,
      referenceText: feedback.reference_text,
    });

    job.updateProgress(50);

    console.log(`[Process Voice Feedback] Changes: ${updatedProfile.changes_made}`);

    // Generate new examples with the updated voice + sample posts as reference
    console.log(`[Process Voice Feedback] Generating new examples...`);
    const contentPrefs = connectedAccount.getContentPreferences();
    const formatting = {
      line_breaks: contentPrefs.line_breaks,
      emojis: contentPrefs.emojis,
    };
    const examples = await AI.generateExamples(updatedProfile, samplePosts, formatting);

    job.updateProgress(80);

    // Get current voice match score (formula-based, not AI-based)
    const currentVoiceMatchScore = await connectedAccount.getVoiceMatchScore();

    // Update profile with generated data and mark as active
    await newProfile.$query().patch({
      status: "active",
      voice_summary: updatedProfile.voice_summary,
      sentence_patterns: updatedProfile.sentence_patterns,
      vocabulary_notes: updatedProfile.vocabulary_notes,
      tone_markers: updatedProfile.tone_markers,
      formatting_habits: updatedProfile.formatting_habits,
      hard_rules: updatedProfile.hard_rules,
      examples,
      confidence: currentVoiceMatchScore / 100, // Normalized 0-1 for storage
      confidence_reasoning: `Updated based on feedback: "${feedback.feedback.substring(0, 50)}..." - ${updatedProfile.changes_made}`,
    });

    job.updateProgress(95);

    // Mark feedback as processed
    await feedback.markProcessed(newProfile.version, updatedProfile.changes_made);

    // Clear the voice update flag
    await connectedAccount.markVoiceUpdateCompleted();

    job.updateProgress(100);

    console.log(`[Process Voice Feedback] ✅ Created profile v${newProfile.version} (voice match: ${currentVoiceMatchScore}%)`);

    return {
      success: true,
      feedback_id: feedbackId,
      old_version: currentProfile.version,
      new_version: newProfile.version,
      voice_match_score: currentVoiceMatchScore,
      changes_made: updatedProfile.changes_made,
    };

  } catch (error) {
    console.error(`[Process Voice Feedback] Error:`, error);

    // Cleanup: mark feedback as failed, delete any generating profile, clear voice update flag
    try {
      const feedback = await VoiceFeedback.query().findById(feedbackId);
      if (feedback) {
        if (feedback.status === "processing") {
          await feedback.markFailed(error.message);
        }
        // Clean up any generating profile
        const generating = await VoiceProfile.getGeneratingProfile(feedback.connected_account_id);
        if (generating) {
          await generating.$query().delete();
          console.log(`[Process Voice Feedback] Cleaned up generating profile ${generating.id}`);
        }
        // Clear the voice update flag
        const conn = await ConnectedAccount.query().findById(feedback.connected_account_id);
        if (conn) {
          await conn.markVoiceUpdateCompleted();
        }
      }
    } catch (updateError) {
      console.error(`[Process Voice Feedback] Cleanup error:`, updateError);
    }

    throw error;
  }
}
