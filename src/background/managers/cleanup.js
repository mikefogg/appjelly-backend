import { WorkerPro } from "@taskforcesh/bullmq-pro";
import { redisOpts } from "#src/utils/redis.js";
import {
  QUEUE_CLEANUP,
  JOB_CLEANUP_EXPIRED_MEDIA,
  JOB_CLEANUP_OLD_ARTIFACTS,
  JOB_CLEANUP_ORPHANED_DATA
} from "#src/background/queues/index.js";

// Import job processors
import cleanupExpiredMedia from "#src/background/jobs/cleanup/expired-media-cleanup.js";

// Import schedulers
import * as cleanupScheduler from "#src/background/repeatables/cleanup-scheduler.js";

console.log("🧹 Starting cleanup worker manager...");

const worker = new WorkerPro(
  QUEUE_CLEANUP,
  async (job) => {
    console.log(`Processing cleanup job: ${job.name} (ID: ${job.id})`);
    
    try {
      switch (job.name) {
        case JOB_CLEANUP_EXPIRED_MEDIA:
          return await cleanupExpiredMedia(job);
          
        case JOB_CLEANUP_OLD_ARTIFACTS:
          // TODO: Implement old artifacts cleanup
          console.log("Old artifacts cleanup not implemented yet");
          return { success: true, message: "Not implemented" };
          
        case JOB_CLEANUP_ORPHANED_DATA:
          // TODO: Implement orphaned data cleanup
          console.log("Orphaned data cleanup not implemented yet");
          return { success: true, message: "Not implemented" };
          
        default:
          throw new Error(`Unknown cleanup job type: ${job.name}`);
      }
    } catch (error) {
      console.error(`Cleanup job ${job.name} failed:`, error);
      throw error;
    }
  },
  {
    connection: redisOpts,
    concurrency: parseInt(process.env.CLEANUP_WORKER_CONCURRENCY || "2"),
    removeOnComplete: 10, // Keep last 10 completed jobs
    removeOnFail: 25, // Keep last 25 failed jobs for debugging
  }
);

// Worker event handlers
worker.on("completed", (job, result) => {
  console.log(`✅ Cleanup job ${job.name} (ID: ${job.id}) completed successfully`);
  if (result?.totalCleaned) {
    console.log(`   - Cleaned up ${result.totalCleaned} items`);
  }
});

worker.on("failed", (job, err) => {
  console.error(`❌ Cleanup job ${job?.name} (ID: ${job?.id}) failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("🚨 Cleanup worker error:", err);
});

worker.on("stalled", (jobId) => {
  console.warn(`⚠️ Cleanup job ${jobId} stalled`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("🛑 Shutting down cleanup worker...");
  try {
    await worker.close();
    console.log("✅ Cleanup worker shut down gracefully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during cleanup worker shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start repeating jobs
const startSchedulers = async () => {
  try {
    console.log("⏰ Creating repeating jobs...");
    await cleanupScheduler.resetScheduledJobs();
    await cleanupScheduler.startScheduledJobs();
    console.log("✅ Repeating jobs configured");
  } catch (error) {
    console.error("❌ Failed to start schedulers:", error);
  }
};

startSchedulers();

console.log("✅ Cleanup worker manager started successfully");
console.log(`   - Queue: ${QUEUE_CLEANUP}`);
console.log(`   - Concurrency: ${worker.opts.concurrency}`);
console.log(`   - Supported jobs: ${JOB_CLEANUP_EXPIRED_MEDIA}, ${JOB_CLEANUP_OLD_ARTIFACTS}, ${JOB_CLEANUP_ORPHANED_DATA}`);

export default worker;