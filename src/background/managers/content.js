import "dotenv/config";
import throng from "throng";
import { WorkerPro } from "@taskforcesh/bullmq-pro";
import {
  JOB_GENERATE_STORY,
  JOB_GENERATE_STORY_IMAGES,
  JOB_REGENERATE_CONTENT,
  JOB_PROCESS_CHARACTER_CLAIM,
  QUEUE_CONTENT_GENERATION,
  JOB_PROCESS_REVENUECAT_WEBHOOK,
  QUEUE_SUBSCRIPTION_PROCESSING,
} from "#src/background/queues/index.js";
import { redisOpts } from "#src/utils/redis.js";
import chalk from "chalk";

// Import and execute content regeneration job
import ProcessRevenueCatWebhookWorker from "#src/background/jobs/subscriptions/process-revenuecat-webhook.js";
import GenerateStoryWorker from "#src/background/jobs/content/generate-story.js";
import GenerateStoryImagesWorker from "#src/background/jobs/content/generate-story-images.js";

let key = "Content Manager";
let workers = process.env.CONTENT_WORKERS
  ? parseInt(process.env.CONTENT_WORKERS)
  : 1;

let concurrency = process.env.CONTENT_CONCURRENCY
  ? parseInt(process.env.CONTENT_CONCURRENCY)
  : 3;

//
// Start our actual workers
//

function start() {
  const loadWorkers = async () => {
    try {
      // Start workers
      console.log("[%s] Starting workers...", key);

      //
      // Content Generation Worker
      //

      const contentWorker = new WorkerPro(
        QUEUE_CONTENT_GENERATION,
        async (job) => {
          try {
            switch (job.name) {
              case JOB_GENERATE_STORY:
                await GenerateStoryWorker(job);
                break;
              case JOB_GENERATE_STORY_IMAGES:
                await GenerateStoryImagesWorker(job);
                break;
              default:
                console.error(`[%s] Unprocessed job: %s`, key, job.name);
                throw new Error(`Unprocessed job: ${job.name}`);
            }
          } catch (error) {
            console.error(
              chalk.red("[%s] Error processing job in worker"),
              key,
              { error }
            );
            throw error;
          }
        },
        {
          connection: redisOpts,
          concurrency,
        }
      );

      // We need to catch errors here so we can log them and not crash the worker
      contentWorker.on("error", (error) => {
        console.error(chalk.red("[%s] Worker error"), key, { error });
      });

      //
      // Subscription Worker
      //

      const subscriptionWorker = new WorkerPro(
        QUEUE_SUBSCRIPTION_PROCESSING,
        async (job) => {
          try {
            switch (job.name) {
              case JOB_PROCESS_REVENUECAT_WEBHOOK:
                await ProcessRevenueCatWebhookWorker(job);
                break;
              default:
                console.error(`[%s] Unprocessed job: %s`, key, job.name);
                throw new Error(`Unprocessed job: ${job.name}`);
            }
          } catch (error) {
            console.error(
              chalk.red("[%s] Error processing job in worker"),
              key,
              { error }
            );
            throw error;
          }
        },
        {
          connection: redisOpts,
          concurrency,
        }
      );

      // We need to catch errors here so we can log them and not crash the worker
      subscriptionWorker.on("error", (error) => {
        console.error(chalk.red("[%s] Worker error"), key, { error });
      });

      console.log("[%s] Workers started!", key);
    } catch (err) {
      console.error(chalk.red("[%s] Failed to start workers"), key, { err });
      throw err;
    }
  };

  loadWorkers();
}

throng({ workers, lifetime: Infinity, start });
