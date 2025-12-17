import throng from "throng";
import { WorkerPro } from "@taskforcesh/bullmq-pro";
import { redisOpts } from "#src/utils/redis.js";
import { QUEUE_TWITTER } from "#src/background/queues/index.js";
import processJob from "#src/background/jobs/process-job.js";

// Import schedulers
import * as topicSyncScheduler from "#src/background/repeatables/topic-sync-scheduler.js";

const key = "Twitter Manager";
const workers = parseInt(process.env.TWITTER_WORKERS || "1");
const concurrency = parseInt(process.env.TWITTER_WORKER_CONCURRENCY || "2");

function start(id) {
  const loadWorkers = async () => {
    try {
      console.log(`[${key}] Starting worker ${id}...`);

      const worker = new WorkerPro(
        QUEUE_TWITTER,
        async (job) => {
          console.log(`Processing Twitter job: ${job.name} (ID: ${job.id})`);

          try {
            return await processJob(job);
          } catch (error) {
            console.error(`Twitter job ${job.name} failed:`, error);
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
        console.log(`✅ Twitter job ${job.name} (ID: ${job.id}) completed successfully`);
        if (result) {
          if (result.posts_synced) {
            console.log(`   - Synced ${result.posts_synced} posts`);
          }
          if (result.profiles_synced) {
            console.log(`   - Synced ${result.profiles_synced} profiles`);
          }
          if (result.dispatched) {
            console.log(`   - Dispatched ${result.dispatched} sync jobs`);
          }
          if (result.new_posts) {
            console.log(`   - ${result.new_posts} new, ${result.updated_posts} updated`);
          }
          if (result.trending_topics_stored) {
            console.log(`   - Stored ${result.trending_topics_stored} trending topics`);
          }
        }
      });

      worker.on("failed", (job, err) => {
        console.error(`❌ Twitter job ${job?.name} (ID: ${job?.id}) failed:`, err.message);
      });

      worker.on("error", (err) => {
        console.error("🚨 Twitter worker error:", err);
      });

      worker.on("stalled", (jobId) => {
        console.warn(`⚠️ Twitter job ${jobId} stalled`);
      });

      // Set up repeatable jobs for topic sync
      console.log(`[${key}] Worker ${id} setting up repeatable jobs...`);
      await topicSyncScheduler.resetScheduledJobs();
      await topicSyncScheduler.startScheduledJobs();
      console.log(`[${key}] ✅ Repeating jobs configured`);

      console.log(`[${key}] Worker ${id} started successfully`);
      console.log(`   - Queue: ${QUEUE_TWITTER}`);
      console.log(`   - Concurrency: ${concurrency}`);
    } catch (err) {
      console.error(`[${key}] Failed to start worker ${id}:`, err);
      throw err;
    }
  };

  loadWorkers();
}

throng({ workers, lifetime: Infinity, start });
