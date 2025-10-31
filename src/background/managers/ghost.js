import { WorkerPro } from "@taskforcesh/bullmq-pro";
import { redisOpts } from "#src/utils/redis.js";
import {
  QUEUE_GHOST,
  JOB_SYNC_NETWORK,
  JOB_ANALYZE_STYLE,
  JOB_GENERATE_SUGGESTIONS,
  JOB_GENERATE_SUGGESTIONS_AUTOMATED,
  JOB_GENERATE_POST,
  JOB_DISPATCH_CURATED_TOPICS,
  JOB_SYNC_CURATED_TOPIC,
  JOB_DIGEST_RECENT_TOPICS,
} from "#src/background/queues/index.js";

// Import job processors
import syncNetwork from "#src/background/jobs/ghost/sync-network.js";
import analyzeStyle from "#src/background/jobs/ghost/analyze-style.js";
import generateSuggestions from "#src/background/jobs/ghost/generate-suggestions.js";
import generateSuggestionsAutomated from "#src/background/jobs/ghost/generate-suggestions-automated.js";
import generatePost from "#src/background/jobs/ghost/generate-post.js";
import dispatchCuratedTopics from "#src/background/jobs/ghost/dispatch-curated-topics.js";
import syncCuratedTopic from "#src/background/jobs/ghost/sync-curated-topic.js";
import digestRecentTopics from "#src/background/jobs/ghost/digest-recent-topics.js";

// Import schedulers
import * as suggestionScheduler from "#src/background/repeatables/suggestion-scheduler.js";
import * as topicSyncScheduler from "#src/background/repeatables/topic-sync-scheduler.js";

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

        case JOB_GENERATE_SUGGESTIONS_AUTOMATED:
          return await generateSuggestionsAutomated(job);

        case JOB_GENERATE_POST:
          return await generatePost(job);

        case JOB_DISPATCH_CURATED_TOPICS:
          return await dispatchCuratedTopics(job);

        case JOB_SYNC_CURATED_TOPIC:
          return await syncCuratedTopic(job);

        case JOB_DIGEST_RECENT_TOPICS:
          return await digestRecentTopics(job);

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
    if (result.jobs_queued) {
      console.log(`   - Queued ${result.jobs_queued} jobs for ${result.accounts_found} accounts`);
    }
    if (result.content_length) {
      console.log(`   - Generated post (${result.content_length} chars)`);
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

// Start repeating jobs
const startSchedulers = async () => {
  try {
    console.log("⏰ Creating repeating jobs...");
    await suggestionScheduler.resetScheduledJobs();
    await topicSyncScheduler.resetScheduledJobs();
    await suggestionScheduler.startScheduledJobs();
    await topicSyncScheduler.startScheduledJobs();
    console.log("✅ Repeating jobs configured");
  } catch (error) {
    console.error("❌ Failed to start schedulers:", error);
  }
};

startSchedulers();

console.log("✅ Ghost worker manager started successfully");
console.log(`   - Queue: ${QUEUE_GHOST}`);
console.log(`   - Concurrency: ${worker.opts.concurrency}`);
console.log(`   - Supported jobs: ${JOB_SYNC_NETWORK}, ${JOB_ANALYZE_STYLE}, ${JOB_GENERATE_SUGGESTIONS}, ${JOB_GENERATE_SUGGESTIONS_AUTOMATED}, ${JOB_GENERATE_POST}, ${JOB_DISPATCH_CURATED_TOPICS}, ${JOB_SYNC_CURATED_TOPIC}, ${JOB_DIGEST_RECENT_TOPICS}`);

export default worker;
