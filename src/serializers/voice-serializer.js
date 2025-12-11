/**
 * Voice feedback serializers
 */

/**
 * Feedback submitted response serializer
 */
export const feedbackSubmittedSerializer = ({ feedbackId, currentVoiceVersion }) => ({
  message: "Feedback received! We'll update your voice profile accordingly.",
  feedback_id: feedbackId,
  current_voice_version: currentVoiceVersion,
});
