import throng from "throng";
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

const key = "Cleanup Manager";
const workers = parseInt(process.env.CLEANUP_WORKERS || "1");
const concurrency = parseInt(process.env.CLEANUP_WORKER_CONCURRENCY || "2");

function start(id) {
  const loadWorkers = async () => {
    try {
      console.log(`[${key}] Starting worker ${id}...`);

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
          concurrency,
          removeOnComplete: 10,
          removeOnFail: 25,
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

      // Set up repeatable jobs
      console.log(`[${key}] Worker ${id} setting up repeatable jobs...`);
      await cleanupScheduler.resetScheduledJobs();
      await cleanupScheduler.startScheduledJobs();
      console.log(`[${key}] ✅ Repeating jobs configured`);

      console.log(`[${key}] Worker ${id} started successfully`);
      console.log(`   - Queue: ${QUEUE_CLEANUP}`);
      console.log(`   - Concurrency: ${concurrency}`);
    } catch (err) {
      console.error(`[${key}] Failed to start worker ${id}:`, err);
      throw err;
    }
  };

  loadWorkers();
}

throng({ workers, lifetime: Infinity, start });
