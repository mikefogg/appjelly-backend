import "dotenv/config";
import throng from "throng";
import { WorkerPro } from "@taskforcesh/bullmq-pro";
import {
  JOB_GENERATE_ARTIFACT_VIDEO,
  QUEUE_VIDEO_GENERATION,
} from "#src/background/queues/index.js";
import { redisOpts } from "#src/utils/redis.js";
import chalk from "chalk";

// Import job processors
import GenerateArtifactVideoWorker from "#src/background/jobs/video/generate-artifact-video.js";

let key = "Video Manager";
let workers = process.env.VIDEO_WORKERS
  ? parseInt(process.env.VIDEO_WORKERS)
  : 1;

let concurrency = process.env.VIDEO_CONCURRENCY
  ? parseInt(process.env.VIDEO_CONCURRENCY)
  : 2; // Lower concurrency for video generation

//
// Start our actual workers
//

function start() {
  const loadWorkers = async () => {
    try {
      // Start workers
      console.log("[%s] Starting workers...", key);

      //
      // Video Generation Worker
      //

      const videoWorker = new WorkerPro(
        QUEUE_VIDEO_GENERATION,
        async (job) => {
          try {
            switch (job.name) {
              case JOB_GENERATE_ARTIFACT_VIDEO:
                await GenerateArtifactVideoWorker(job);
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
            max: 3,          // Maximum 3 videos processed
            duration: 60000, // Per minute (video generation is resource intensive)
          },
        }
      );

      // We need to catch errors here so we can log them and not crash the worker
      videoWorker.on("error", (error) => {
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