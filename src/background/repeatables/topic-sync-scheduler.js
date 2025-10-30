import { ghostQueue, JOB_DISPATCH_CURATED_TOPICS } from "#src/background/queues/index.js";

console.log("⏰ Setting up curated topics sync scheduler...");

// Schedule dispatch-curated-topics to run every 30 minutes
const scheduleTopicSync = async () => {
  try {
    // Remove any existing scheduled jobs for this type
    const existingJobs = await ghostQueue.getRepeatableJobs();
    const topicSyncJobs = existingJobs.filter(job => job.name === JOB_DISPATCH_CURATED_TOPICS);

    for (const job of topicSyncJobs) {
      await ghostQueue.removeRepeatableByKey(job.key);
      console.log("🗑️ Removed existing topic sync schedule");
    }

    // Add new repeatable job - every 30 minutes
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

    console.log("✅ Scheduled dispatch-curated-topics job (every 30 minutes)");
  } catch (error) {
    console.error("❌ Failed to schedule topic sync:", error);
  }
};

// Initialize schedule
const setupTopicSyncSchedule = async () => {
  await scheduleTopicSync();
  console.log("✅ Topic sync schedule configured");
};

// Run setup
setupTopicSyncSchedule().catch(error => {
  console.error("❌ Failed to setup topic sync schedule:", error);
  process.exit(1);
});

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

console.log("✅ Topic sync scheduler setup complete");
