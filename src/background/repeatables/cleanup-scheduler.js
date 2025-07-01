import { cleanupQueue, JOB_CLEANUP_EXPIRED_MEDIA } from "#src/background/queues/index.js";

console.log("⏰ Setting up cleanup job schedulers...");

// Schedule expired media cleanup to run every 4 hours
const scheduleExpiredMediaCleanup = async () => {
  try {
    // Remove any existing scheduled jobs for this type
    const existingJobs = await cleanupQueue.getRepeatableJobs();
    const expiredMediaJobs = existingJobs.filter(job => job.name === JOB_CLEANUP_EXPIRED_MEDIA);
    
    for (const job of expiredMediaJobs) {
      await cleanupQueue.removeRepeatableByKey(job.key);
      console.log("🗑️ Removed existing expired media cleanup schedule");
    }

    // Add new repeatable job - every 4 hours
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

    console.log("✅ Scheduled expired media cleanup job (every 4 hours)");
  } catch (error) {
    console.error("❌ Failed to schedule expired media cleanup:", error);
  }
};

// Schedule all cleanup jobs
const setupCleanupSchedules = async () => {
  await scheduleExpiredMediaCleanup();
  
  // Add more scheduled cleanup jobs here in the future
  console.log("✅ All cleanup schedules configured");
};

// Initialize schedules
setupCleanupSchedules().catch(error => {
  console.error("❌ Failed to setup cleanup schedules:", error);
  process.exit(1);
});

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

console.log("✅ Cleanup scheduler setup complete");