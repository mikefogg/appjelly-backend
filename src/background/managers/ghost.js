import { WorkerPro } from "@taskforcesh/bullmq-pro";
import { redisOpts } from "#src/utils/redis.js";
import {
  QUEUE_GHOST,
  JOB_SYNC_NETWORK,
  JOB_ANALYZE_STYLE,
  JOB_GENERATE_SUGGESTIONS,
  JOB_GENERATE_POST,
} from "#src/background/queues/index.js";

// Import job processors
import syncNetwork from "#src/background/jobs/ghost/sync-network.js";
import analyzeStyle from "#src/background/jobs/ghost/analyze-style.js";
import generateSuggestions from "#src/background/jobs/ghost/generate-suggestions.js";
import generatePost from "#src/background/jobs/ghost/generate-post.js";

console.log("👻 Starting Ghost worker manager...");

const worker = new WorkerPro(
  QUEUE_GHOST,
  async (job) => {
    console.log(`Processing Ghost job: ${job.name} (ID: ${job.id})`);

    try {
      switch (job.name) {
        case JOB_SYNC_NETWORK:
          return await syncNetwork(job);

        case JOB_ANALYZE_STYLE:
          return await analyzeStyle(job);

        case JOB_GENERATE_SUGGESTIONS:
          return await generateSuggestions(job);

        case JOB_GENERATE_POST:
          return await generatePost(job);

        default:
          throw new Error(`Unknown Ghost job type: ${job.name}`);
      }
    } catch (error) {
      console.error(`Ghost job ${job.name} failed:`, error);
      throw error;
    }
  },
  {
    connection: redisOpts,
    concurrency: parseInt(process.env.GHOST_WORKER_CONCURRENCY || "3"),
    removeOnComplete: 10, // Keep last 10 completed jobs
    removeOnFail: 25, // Keep last 25 failed jobs for debugging
  }
);

// Worker event handlers
worker.on("completed", (job, result) => {
  console.log(`✅ Ghost job ${job.name} (ID: ${job.id}) completed successfully`);
  if (result) {
    if (result.posts_synced) {
      console.log(`   - Synced ${result.posts_synced} posts`);
    }
    if (result.profiles_synced) {
      console.log(`   - Synced ${result.profiles_synced} profiles`);
    }
    if (result.posts_analyzed) {
      console.log(`   - Analyzed ${result.posts_analyzed} posts`);
    }
    if (result.suggestions_generated) {
      console.log(`   - Generated ${result.suggestions_generated} suggestions`);
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

// Graceful shutdown
const shutdown = async () => {
  console.log("🛑 Shutting down Ghost worker...");
  try {
    await worker.close();
    console.log("✅ Ghost worker shut down gracefully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during Ghost worker shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("✅ Ghost worker manager started successfully");
console.log(`   - Queue: ${QUEUE_GHOST}`);
console.log(`   - Concurrency: ${worker.opts.concurrency}`);
console.log(`   - Supported jobs: ${JOB_SYNC_NETWORK}, ${JOB_ANALYZE_STYLE}, ${JOB_GENERATE_SUGGESTIONS}, ${JOB_GENERATE_POST}`);

export default worker;
