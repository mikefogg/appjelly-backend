import throng from "throng";
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
  JOB_SEND_PUSH_NOTIFICATION,
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
import sendPushNotificationJob from "#src/background/jobs/ghost/send-push-notification.js";

// Import schedulers
import * as suggestionScheduler from "#src/background/repeatables/suggestion-scheduler.js";
import * as topicSyncScheduler from "#src/background/repeatables/topic-sync-scheduler.js";

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

              case JOB_SEND_PUSH_NOTIFICATION:
                return await sendPushNotificationJob(job);

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
          concurrency,
          removeOnComplete: 10,
          removeOnFail: 25,
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

      // Set up repeatable jobs
      console.log(`[${key}] Worker ${id} setting up repeatable jobs...`);
      await suggestionScheduler.resetScheduledJobs();
      await topicSyncScheduler.resetScheduledJobs();
      await suggestionScheduler.startScheduledJobs();
      await topicSyncScheduler.startScheduledJobs();
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
