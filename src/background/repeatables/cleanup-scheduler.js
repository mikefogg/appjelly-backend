import chalk from "chalk";
import { cleanupQueue, JOB_CLEANUP_EXPIRED_MEDIA } from "#src/background/queues/index.js";
import { clearAllRepeatableJobs } from "#src/utils/redis.js";

const key = "Cleanup Scheduler";

export const startScheduledJobs = async () => {
  try {
    // Add repeatable job - every 4 hours
    await cleanupQueue.add(
      JOB_CLEANUP_EXPIRED_MEDIA,
      {
        batchSize: 100,
        maxRetries: 3,
      },
      {
        repeat: {
          pattern: "0 */4 * * *", // Every 4 hours at minute 0
        },
        jobId: "expired-media-cleanup-scheduled",
        removeOnComplete: 5,
        removeOnFail: 10,
      }
    );

    console.log(chalk.green("[%s] Scheduled expired media cleanup job (every 4 hours)"), key);
  } catch (error) {
    console.error(chalk.red("[%s] Failed to schedule cleanup"), key, error);
    throw error;
  }
};

export const resetScheduledJobs = async () => {
  try {
    // Clear all of our repeatables first
    await clearAllRepeatableJobs(cleanupQueue);
    console.log(chalk.dim("[%s] Cleared repeatable jobs..."), key);

    // Small delay to ensure Redis consistency after clearing
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (error) {
    console.error(chalk.red("[%s] Failed to reset scheduled jobs"), key, error);
    throw error;
  }
};

// Helper function to manually trigger cleanup
export const triggerManualCleanup = async (jobType = JOB_CLEANUP_EXPIRED_MEDIA, options = {}) => {
  try {
    const job = await cleanupQueue.add(jobType, {
      ...options,
      manual: true,
      triggeredAt: new Date().toISOString(),
    });
    
    console.log(`🚀 Manually triggered ${jobType} cleanup job (ID: ${job.id})`);
    return job;
  } catch (error) {
    console.error(`❌ Failed to trigger manual ${jobType} cleanup:`, error);
    throw error;
  }
};

// Helper to check scheduled jobs
export const getScheduledCleanupJobs = async () => {
  try {
    const repeatableJobs = await cleanupQueue.getRepeatableJobs();
    return repeatableJobs.map(job => ({
      name: job.name,
      pattern: job.cron,
      next: job.next,
      key: job.key,
    }));
  } catch (error) {
    console.error("❌ Failed to get scheduled cleanup jobs:", error);
    return [];
  }
};