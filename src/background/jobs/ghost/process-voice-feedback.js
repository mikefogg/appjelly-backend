/**
 * Process Voice Feedback Job
 * Takes user feedback and updates the voice profile accordingly
 */

import { VoiceFeedback, VoiceProfile, SamplePost } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";

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

    // Mark as processing
    await feedback.markProcessing();
    job.updateProgress(10);

    // Get current voice profile
    const currentProfile = await VoiceProfile.getCurrentProfile(feedback.connected_account_id);

    if (!currentProfile) {
      // No existing profile - create one first
      console.log(`[Process Voice Feedback] No voice profile exists, creating base profile first`);
      await feedback.markFailed("No voice profile exists. Please add sample posts first.");
      return {
        success: false,
        reason: "No voice profile exists",
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
    const examples = await AI.generateExamples(updatedProfile, samplePosts);

    job.updateProgress(80);

    // Calculate new confidence
    const newConfidence = Math.min(
      (currentProfile.confidence || 0.5) + (updatedProfile.confidence_delta || 0.02),
      0.98
    );

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
      confidence: newConfidence,
      confidence_reasoning: `Updated based on feedback: "${feedback.feedback.substring(0, 50)}..." - ${updatedProfile.changes_made}`,
    });

    job.updateProgress(95);

    // Mark feedback as processed
    await feedback.markProcessed(newProfile.version, updatedProfile.changes_made);

    job.updateProgress(100);

    console.log(`[Process Voice Feedback] ✅ Created profile v${newProfile.version} (confidence: ${(newConfidence * 100).toFixed(0)}%)`);

    return {
      success: true,
      feedback_id: feedbackId,
      old_version: currentProfile.version,
      new_version: newProfile.version,
      old_confidence: currentProfile.confidence,
      new_confidence: newConfidence,
      changes_made: updatedProfile.changes_made,
    };

  } catch (error) {
    console.error(`[Process Voice Feedback] Error:`, error);

    // Cleanup: mark feedback as failed and delete any generating profile
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
      }
    } catch (updateError) {
      console.error(`[Process Voice Feedback] Cleanup error:`, updateError);
    }

    throw error;
  }
}
