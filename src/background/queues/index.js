import { Queue } from "bullmq";
import { redisOpts } from "#src/utils/redis.js";

// Default options
const removeOnFailCount = process.env.KEEP_FAILED_JOBS_COUNT
  ? Number(process.env.KEEP_FAILED_JOBS_COUNT) // Keep X number of failed jobs
  : true; // Or remove immediately if not set

const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: removeOnFailCount,
  attempts: 10,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
};

// Queue Names
export const QUEUE_SUBSCRIPTION_PROCESSING = "subscription-processing";
export const QUEUE_NOTIFICATIONS = "notifications";
export const QUEUE_ANALYTICS = "analytics";
export const QUEUE_CONTENT_GENERATION = "content-generation";
export const QUEUE_MEDIA_PROCESSING = "media-processing";
export const QUEUE_CONTENT_SAFETY = "content-safety";
export const QUEUE_CLEANUP = "cleanup";

// Queue Instances
export const subscriptionQueue = new Queue(QUEUE_SUBSCRIPTION_PROCESSING, { connection: redisOpts, defaultJobOptions });
export const notificationQueue = new Queue(QUEUE_NOTIFICATIONS, { connection: redisOpts, defaultJobOptions });
export const analyticsQueue = new Queue(QUEUE_ANALYTICS, { connection: redisOpts, defaultJobOptions });
export const contentQueue = new Queue(QUEUE_CONTENT_GENERATION, { connection: redisOpts, defaultJobOptions });
export const mediaQueue = new Queue(QUEUE_MEDIA_PROCESSING, { connection: redisOpts, defaultJobOptions });
export const safetyQueue = new Queue(QUEUE_CONTENT_SAFETY, { connection: redisOpts, defaultJobOptions });
export const cleanupQueue = new Queue(QUEUE_CLEANUP, { connection: redisOpts, defaultJobOptions });

// Job Constants
// Subscription Jobs
export const JOB_PROCESS_REVENUECAT_WEBHOOK = "process-revenuecat-webhook";
export const JOB_SYNC_SUBSCRIPTION_STATUS = "sync-subscription-status";
export const JOB_CHECK_EXPIRED_SUBSCRIPTIONS = "check-expired-subscriptions";

// Notification Jobs
export const JOB_WELCOME_EMAIL = "welcome-email";
export const JOB_SUBSCRIPTION_REMINDER = "subscription-reminder";
export const JOB_BILLING_ISSUE_EMAIL = "billing-issue-email";
export const JOB_SEND_PUSH_NOTIFICATION = "send-push-notification";
export const JOB_EXPIRY_WARNING_EMAIL = "expiry-warning-email";

// Analytics Jobs
export const JOB_UPDATE_USER_ANALYTICS = "update-user-analytics";
export const JOB_TRACK_SUBSCRIPTION_EVENT = "track-subscription-event";
export const JOB_DAILY_USAGE_REPORT = "daily-usage-report";

// Content Jobs
export const JOB_GENERATE_STORY = "generate-story";
export const JOB_GENERATE_STORY_IMAGES = "generate-story-images";
export const JOB_REGENERATE_CONTENT = "regenerate-content";
export const JOB_PROCESS_CHARACTER_CLAIM = "process-character-claim";

// Media Jobs
export const JOB_PROCESS_IMAGE_UPLOAD = "process-image-upload";
export const JOB_GENERATE_THUMBNAILS = "generate-thumbnails";
export const JOB_OPTIMIZE_IMAGES = "optimize-images";
export const JOB_PROCESS_ACTOR_IMAGE = "process-actor-image";
export const JOB_GENERATE_PAGE_IMAGE = "generate-page-image";
export const JOB_GENERATE_PAGE_AUDIO = "generate-page-audio";
export const JOB_GENERATE_ARTIFACT_AUDIO = "generate-artifact-audio";
export const JOB_GENERATE_STORY_AUDIO = "generate-story-audio";

// Safety Jobs
export const JOB_MODERATE_CONTENT = "moderate-content";
export const JOB_PROCESS_CONTENT_REPORT = "process-content-report";
export const JOB_SCAN_USER_CONTENT = "scan-user-content";

// Cleanup Jobs
export const JOB_CLEANUP_EXPIRED_MEDIA = "cleanup-expired-media";
export const JOB_CLEANUP_OLD_ARTIFACTS = "cleanup-old-artifacts";
export const JOB_CLEANUP_ORPHANED_DATA = "cleanup-orphaned-data";

// Organized job objects for backward compatibility
export const SUBSCRIPTION_JOBS = {
  PROCESS_REVENUECAT_WEBHOOK: JOB_PROCESS_REVENUECAT_WEBHOOK,
  SYNC_SUBSCRIPTION_STATUS: JOB_SYNC_SUBSCRIPTION_STATUS,
  CHECK_EXPIRED_SUBSCRIPTIONS: JOB_CHECK_EXPIRED_SUBSCRIPTIONS,
};

export const NOTIFICATION_JOBS = {
  WELCOME_EMAIL: JOB_WELCOME_EMAIL,
  SUBSCRIPTION_REMINDER: JOB_SUBSCRIPTION_REMINDER,
  BILLING_ISSUE_EMAIL: JOB_BILLING_ISSUE_EMAIL,
  SEND_PUSH_NOTIFICATION: JOB_SEND_PUSH_NOTIFICATION,
  EXPIRY_WARNING_EMAIL: JOB_EXPIRY_WARNING_EMAIL,
};

export const ANALYTICS_JOBS = {
  UPDATE_USER_ANALYTICS: JOB_UPDATE_USER_ANALYTICS,
  TRACK_SUBSCRIPTION_EVENT: JOB_TRACK_SUBSCRIPTION_EVENT,
  DAILY_USAGE_REPORT: JOB_DAILY_USAGE_REPORT,
};

export const CONTENT_JOBS = {
  GENERATE_STORY: JOB_GENERATE_STORY,
  GENERATE_STORY_IMAGES: JOB_GENERATE_STORY_IMAGES,
  REGENERATE_CONTENT: JOB_REGENERATE_CONTENT,
  PROCESS_CHARACTER_CLAIM: JOB_PROCESS_CHARACTER_CLAIM,
};

export const MEDIA_JOBS = {
  PROCESS_IMAGE_UPLOAD: JOB_PROCESS_IMAGE_UPLOAD,
  GENERATE_THUMBNAILS: JOB_GENERATE_THUMBNAILS,
  OPTIMIZE_IMAGES: JOB_OPTIMIZE_IMAGES,
  PROCESS_ACTOR_IMAGE: JOB_PROCESS_ACTOR_IMAGE,
  GENERATE_PAGE_IMAGE: JOB_GENERATE_PAGE_IMAGE,
  GENERATE_PAGE_AUDIO: JOB_GENERATE_PAGE_AUDIO,
  GENERATE_ARTIFACT_AUDIO: JOB_GENERATE_ARTIFACT_AUDIO,
  GENERATE_STORY_AUDIO: JOB_GENERATE_STORY_AUDIO,
};

export const SAFETY_JOBS = {
  MODERATE_CONTENT: JOB_MODERATE_CONTENT,
  PROCESS_CONTENT_REPORT: JOB_PROCESS_CONTENT_REPORT,
  SCAN_USER_CONTENT: JOB_SCAN_USER_CONTENT,
};

export const CLEANUP_JOBS = {
  CLEANUP_EXPIRED_MEDIA: JOB_CLEANUP_EXPIRED_MEDIA,
  CLEANUP_OLD_ARTIFACTS: JOB_CLEANUP_OLD_ARTIFACTS,
  CLEANUP_ORPHANED_DATA: JOB_CLEANUP_ORPHANED_DATA,
};

// Queue health check utility
export const getQueueHealth = async () => {
  const queues = [
    { name: "subscription", queue: subscriptionQueue },
    { name: "notification", queue: notificationQueue },
    { name: "analytics", queue: analyticsQueue },
    { name: "content", queue: contentQueue },
    { name: "media", queue: mediaQueue },
    { name: "safety", queue: safetyQueue },
    { name: "cleanup", queue: cleanupQueue },
  ];

  const health = {};
  
  for (const { name, queue } of queues) {
    try {
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
      ]);

      health[name] = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        status: "healthy",
      };
    } catch (error) {
      health[name] = {
        status: "error",
        error: error.message,
      };
    }
  }

  return health;
};