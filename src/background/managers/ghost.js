import throng from "throng";
import { WorkerPro } from "@taskforcesh/bullmq-pro";
import { redisOpts } from "#src/utils/redis.js";
import { QUEUE_GHOST, QUEUE_SUBSCRIPTION_PROCESSING } from "#src/background/queues/index.js";
import processJob from "#src/background/jobs/process-job.js";

// Import schedulers
import * as suggestionScheduler from "#src/background/repeatables/suggestion-scheduler.js";

const key = "Ghost Manager";
const workers = parseInt(process.env.GHOST_WORKERS || "2");
const concurrency = parseInt(process.env.GHOST_WORKER_CONCURRENCY || "3");

function start(id) {
  const loadWorkers = async () => {
    try {
      console.log(`[${key}] Starting worker ${id}...`);

      const worker = new WorkerPro(
        QUEUE_GHOST,
        async (job) => {
          console.log(`Processing Ghost job: ${job.name} (ID: ${job.id})`);

          try {
            return await processJob(job);
          } catch (error) {
            console.error(`Ghost job ${job.name} failed:`, error);
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
        console.log(`✅ Ghost job ${job.name} (ID: ${job.id}) completed successfully`);
        if (result) {
          if (result.posts_analyzed) {
            console.log(`   - Analyzed ${result.posts_analyzed} posts`);
          }
          if (result.suggestions_generated) {
            console.log(`   - Generated ${result.suggestions_generated} suggestions`);
          }
          if (result.jobs_queued) {
            console.log(`   - Queued ${result.jobs_queued} jobs for ${result.accounts_found} accounts`);
          }
          if (result.content_length) {
            console.log(`   - Generated post (${result.content_length} chars)`);
          }
        }
      });

      worker.on("failed", (job, err) => {
        console.error(`❌ Ghost job ${job?.name} (ID: ${job?.id}) failed:`, err.message);
      });

      worker.on("error", (err) => {
        console.error("🚨 Ghost worker error:", err);
      });

      worker.on("stalled", (jobId) => {
        console.warn(`⚠️ Ghost job ${jobId} stalled`);
      });

      // Subscription worker for RevenueCat webhooks
      const subscriptionWorker = new WorkerPro(
        QUEUE_SUBSCRIPTION_PROCESSING,
        async (job) => {
          console.log(`Processing subscription job: ${job.name} (ID: ${job.id})`);

          try {
            return await processJob(job);
          } catch (error) {
            console.error(`Subscription job ${job.name} failed:`, error);
            throw error;
          }
        },
        {
          connection: redisOpts,
          concurrency: 2,
          removeOnComplete: 10,
          removeOnFail: 25,
        }
      );

      subscriptionWorker.on("completed", (job, result) => {
        console.log(`✅ Subscription job ${job.name} (ID: ${job.id}) completed successfully`);
      });

      subscriptionWorker.on("failed", (job, err) => {
        console.error(`❌ Subscription job ${job?.name} (ID: ${job?.id}) failed:`, err.message);
      });

      subscriptionWorker.on("error", (err) => {
        console.error("🚨 Subscription worker error:", err);
      });

      console.log(`[${key}] Subscription worker started`);
      console.log(`   - Queue: ${QUEUE_SUBSCRIPTION_PROCESSING}`);

      // Set up repeatable jobs
      console.log(`[${key}] Worker ${id} setting up repeatable jobs...`);
      await suggestionScheduler.resetScheduledJobs();
      await suggestionScheduler.startScheduledJobs();
      console.log(`[${key}] ✅ Repeating jobs configured`);

      console.log(`[${key}] Worker ${id} started successfully`);
      console.log(`   - Queue: ${QUEUE_GHOST}`);
      console.log(`   - Concurrency: ${concurrency}`);
    } catch (err) {
      console.error(`[${key}] Failed to start worker ${id}:`, err);
      throw err;
    }
  };

  loadWorkers();
}

throng({ workers, lifetime: Infinity, start });
