import chalk from "chalk";
import { ghostQueue, JOB_DISPATCH_CURATED_TOPICS } from "#src/background/queues/index.js";
import { clearAllRepeatableJobs } from "#src/utils/redis.js";

const key = "Topic Sync Scheduler";

export const startScheduledJobs = async () => {
  try {
    // Add repeatable job - every 30 minutes
    await ghostQueue.add(
      JOB_DISPATCH_CURATED_TOPICS,
      {
        triggeredAt: new Date().toISOString(),
      },
      {
        repeat: {
          pattern: "*/30 * * * *", // Every 30 minutes
        },
        jobId: "dispatch-curated-topics-automated",
        removeOnComplete: 10,
        removeOnFail: 20,
      }
    );

    console.log(chalk.green("[%s] Scheduled dispatch-curated-topics job (every 30 minutes)"), key);
  } catch (error) {
    console.error(chalk.red("[%s] Failed to schedule topic sync"), key, error);
    throw error;
  }
};

export const resetScheduledJobs = async () => {
  try {
    // Clear all of our repeatables first
    await clearAllRepeatableJobs(ghostQueue);
    console.log(chalk.dim("[%s] Cleared repeatable jobs..."), key);

    // Small delay to ensure Redis consistency after clearing
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (error) {
    console.error(chalk.red("[%s] Failed to reset scheduled jobs"), key, error);
    throw error;
  }
};

// Helper to manually trigger topic dispatch
export const triggerManualTopicDispatch = async () => {
  try {
    console.log("🚀 Manually triggering curated topics dispatch...");

    const job = await ghostQueue.add(JOB_DISPATCH_CURATED_TOPICS, {
      manual: true,
      triggeredAt: new Date().toISOString(),
    });

    console.log(`✅ Queued dispatch-curated-topics job (ID: ${job.id})`);
    return job;
  } catch (error) {
    console.error("❌ Failed to trigger manual topic dispatch:", error);
    throw error;
  }
};

// Helper to check scheduled topic sync jobs
export const getScheduledTopicSyncJobs = async () => {
  try {
    const repeatableJobs = await ghostQueue.getRepeatableJobs();
    return repeatableJobs
      .filter(job => job.name === JOB_DISPATCH_CURATED_TOPICS)
      .map(job => ({
        name: job.name,
        pattern: job.cron,
        next: job.next,
        key: job.key,
      }));
  } catch (error) {
    console.error("❌ Failed to get scheduled topic sync jobs:", error);
    return [];
  }
};
