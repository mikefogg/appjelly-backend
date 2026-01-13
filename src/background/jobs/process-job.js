/**
 * Unified Job Processor
 * Single switch statement for all job types - used by all worker managers
 */

import {
  JOB_SYNC_NETWORK,
  JOB_ANALYZE_STYLE,
  JOB_GENERATE_SUGGESTIONS,
  JOB_GENERATE_SUGGESTIONS_AUTOMATED,
  JOB_GENERATE_POST,
  JOB_IMPROVE_POST,
  JOB_GENERATE_VOICE_PROFILE,
  JOB_PROCESS_VOICE_FEEDBACK,
  JOB_DISPATCH_CURATED_TOPICS,
  JOB_SYNC_CURATED_TOPIC,
  JOB_DIGEST_RECENT_TOPICS,
  JOB_GENERATE_EVERGREEN_TOPICS,
  JOB_SEND_PUSH_NOTIFICATION,
  JOB_PROCESS_REVENUECAT_WEBHOOK,
  JOB_SYNC_SUBSCRIPTION_STATUS,
  JOB_MIGRATE_CW_CAPTIONS,
  JOB_GENERATE_ONBOARDING_SAMPLE,
} from "#src/background/queues/index.js";

// Ghost jobs
import analyzeStyle from "#src/background/jobs/ghost/analyze-style.js";
import generateSuggestions from "#src/background/jobs/ghost/generate-suggestions.js";
import migrateCwCaptions from "#src/background/jobs/ghost/migrate-cw-captions.js";
import generateSuggestionsAutomated from "#src/background/jobs/ghost/generate-suggestions-automated.js";
import generatePost from "#src/background/jobs/ghost/generate-post.js";
import improvePost from "#src/background/jobs/ghost/improve-post.js";
import generateVoiceProfile from "#src/background/jobs/ghost/generate-voice-profile.js";
import processVoiceFeedback from "#src/background/jobs/ghost/process-voice-feedback.js";
import generateEvergreenTopics from "#src/background/jobs/ghost/generate-evergreen-topics.js";
import sendPushNotificationJob from "#src/background/jobs/ghost/send-push-notification.js";
import generateOnboardingSample from "#src/background/jobs/ghost/generate-onboarding-sample.js";

// Twitter jobs
import syncNetwork from "#src/background/jobs/ghost/sync-network.js";
import dispatchCuratedTopics from "#src/background/jobs/ghost/dispatch-curated-topics.js";
import syncCuratedTopic from "#src/background/jobs/ghost/sync-curated-topic.js";
import digestRecentTopics from "#src/background/jobs/ghost/digest-recent-topics.js";

// Subscription jobs
import processRevenueCatWebhook from "#src/background/jobs/subscriptions/process-revenuecat-webhook.js";
import syncSubscriptionStatus from "#src/background/jobs/subscriptions/sync-subscription-status.js";

/**
 * Process any job type
 * @param {Object} job - BullMQ job object
 * @returns {Promise<Object>} Job result
 */
export default async function processJob(job) {
  switch (job.name) {
    // Ghost jobs - AI/content generation
    case JOB_ANALYZE_STYLE:
      return await analyzeStyle(job);

    case JOB_GENERATE_SUGGESTIONS:
      return await generateSuggestions(job);

    case JOB_GENERATE_SUGGESTIONS_AUTOMATED:
      return await generateSuggestionsAutomated(job);

    case JOB_GENERATE_POST:
      return await generatePost(job);

    case JOB_IMPROVE_POST:
      return await improvePost(job);

    case JOB_GENERATE_VOICE_PROFILE:
      return await generateVoiceProfile(job);

    case JOB_PROCESS_VOICE_FEEDBACK:
      return await processVoiceFeedback(job);

    case JOB_GENERATE_EVERGREEN_TOPICS:
      return await generateEvergreenTopics(job);

    case JOB_SEND_PUSH_NOTIFICATION:
      return await sendPushNotificationJob(job);

    case JOB_MIGRATE_CW_CAPTIONS:
      return await migrateCwCaptions(job);

    case JOB_GENERATE_ONBOARDING_SAMPLE:
      return await generateOnboardingSample(job);

    // Twitter jobs - external API calls
    case JOB_SYNC_NETWORK:
      return await syncNetwork(job);

    case JOB_DISPATCH_CURATED_TOPICS:
      return await dispatchCuratedTopics(job);

    case JOB_SYNC_CURATED_TOPIC:
      return await syncCuratedTopic(job);

    case JOB_DIGEST_RECENT_TOPICS:
      return await digestRecentTopics(job);

    // Subscription jobs
    case JOB_PROCESS_REVENUECAT_WEBHOOK:
      return await processRevenueCatWebhook(job);

    case JOB_SYNC_SUBSCRIPTION_STATUS:
      return await syncSubscriptionStatus(job);

    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
}
