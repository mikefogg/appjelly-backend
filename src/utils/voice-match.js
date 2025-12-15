/**
 * Calculate voice match score (0-100)
 *
 * Scoring breakdown:
 * - Samples: 5% each, max 50%
 * - Feedback: 5% each, max 50%
 * - Rules: 2% each, max 10%
 * - Topics: 5% each, max 15%
 * - Bio fields: 5% each, max 20%
 *
 * @param {Object} params
 * @param {number} params.sampleCount - Number of sample posts
 * @param {number} params.feedbackCount - Number of voice feedback entries
 * @param {number} params.rulesCount - Number of active rules
 * @param {number} params.topicsCount - Number of topics selected
 * @param {Object} params.bio - Bio object with what_you_do, audience, perspective, differentiator
 * @returns {number} Score from 0-100
 */
export const calculateVoiceMatchScore = ({
  sampleCount = 0,
  feedbackCount = 0,
  rulesCount = 0,
  topicsCount = 0,
  bio = {},
}) => {
  const sampleScore = Math.min(sampleCount * 5, 50);
  const feedbackScore = Math.min(feedbackCount * 5, 50);
  const rulesScore = Math.min(rulesCount * 2, 10);
  const topicsScore = Math.min(topicsCount * 5, 15);

  // Count filled bio fields
  const bioFields = ['what_you_do', 'audience', 'perspective', 'differentiator'];
  const filledBioCount = bioFields.filter(f => bio[f]?.trim()).length;
  const bioScore = filledBioCount * 5;

  return Math.min(sampleScore + feedbackScore + rulesScore + bioScore + topicsScore, 100);
};
