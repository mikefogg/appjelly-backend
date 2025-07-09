import "dotenv/config";
import throng from "throng";
import { WorkerPro } from "@taskforcesh/bullmq-pro";
import {
  JOB_PROCESS_IMAGE_UPLOAD,
  JOB_GENERATE_THUMBNAILS,
  JOB_OPTIMIZE_IMAGES,
  JOB_PROCESS_ACTOR_IMAGE,
  JOB_GENERATE_PAGE_IMAGE,
  JOB_GENERATE_PAGE_AUDIO,
  JOB_GENERATE_ARTIFACT_AUDIO,
  JOB_GENERATE_STORY_AUDIO,
  QUEUE_MEDIA_PROCESSING,
} from "#src/background/queues/index.js";
import { redisOpts } from "#src/utils/redis.js";
import chalk from "chalk";

// Import job processors
import ProcessImageUploadWorker from "#src/background/jobs/media/process-image-upload.js";
import ProcessActorImageWorker from "#src/background/jobs/images/process-actor-image.js";
import GeneratePageImageWorker from "#src/background/jobs/images/generate-page-image.js";
import GeneratePageAudioWorker from "#src/background/jobs/audio/generate-page-audio.js";
import GenerateArtifactAudioWorker from "#src/background/jobs/audio/generate-artifact-audio.js";
import GenerateStoryAudioWorker from "#src/background/jobs/audio/generate-story-audio.js";

let key = "Media Manager";
let workers = process.env.MEDIA_WORKERS
  ? parseInt(process.env.MEDIA_WORKERS)
  : 1;

let concurrency = process.env.MEDIA_CONCURRENCY
  ? parseInt(process.env.MEDIA_CONCURRENCY)
  : 10; // Updated from 2 to 10 for higher image processing concurrency

//
// Start our actual workers
//

function start() {
  const loadWorkers = async () => {
    try {
      // Start workers
      console.log("[%s] Starting workers...", key);

      //
      // Media Processing Worker
      //

      const mediaWorker = new WorkerPro(
        QUEUE_MEDIA_PROCESSING,
        async (job) => {
          try {
            switch (job.name) {
              case JOB_PROCESS_IMAGE_UPLOAD:
                await ProcessImageUploadWorker(job);
                break;
              case JOB_GENERATE_THUMBNAILS:
                console.log(`[%s] Thumbnail generation not implemented yet`, key);
                break;
              case JOB_OPTIMIZE_IMAGES:
                console.log(`[%s] Image optimization not implemented yet`, key);
                break;
              case JOB_PROCESS_ACTOR_IMAGE:
                await ProcessActorImageWorker(job);
                break;
              case JOB_GENERATE_PAGE_IMAGE:
                await GeneratePageImageWorker(job);
                break;
              case JOB_GENERATE_PAGE_AUDIO:
                await GeneratePageAudioWorker(job);
                break;
              case JOB_GENERATE_ARTIFACT_AUDIO:
                await GenerateArtifactAudioWorker(job);
                break;
              case JOB_GENERATE_STORY_AUDIO:
                await GenerateStoryAudioWorker(job);
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
          limiter: {
            max: 5,        // Maximum 5 jobs processed
            duration: 60000, // Per minute (60,000ms)
          },
        }
      );

      // We need to catch errors here so we can log them and not crash the worker
      mediaWorker.on("error", (error) => {
        console.error(chalk.red("[%s] Worker error"), key, { error });
      });

      mediaWorker.on("completed", (job) => {
        console.log(chalk.green("[%s] Job completed:"), key, job.name);
      });

      mediaWorker.on("failed", (job, err) => {
        console.error(chalk.red("[%s] Job failed:"), key, job?.name, err?.message);
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