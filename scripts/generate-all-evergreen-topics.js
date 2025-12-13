/**
 * Generate Evergreen Topics for ALL Categories
 * Usage: npm run generate-evergreen-topics [--force]
 *
 * This script queues jobs to generate evergreen topics for every curated topic category.
 * Categories that already have 35+ evergreen topics will be skipped unless --force is used.
 */

import { CuratedTopic } from "../src/models/index.js";
import { ghostQueue, JOB_GENERATE_EVERGREEN_TOPICS } from "../src/background/queues/index.js";

const force = process.argv.includes("--force");

async function generateAllEvergreenTopics() {
  try {
    // Get all curated topics
    const topics = await CuratedTopic.query().orderBy("name");

    console.log(`Found ${topics.length} curated topics`);
    console.log(`Force mode: ${force ? "ON (will regenerate all)" : "OFF (skip existing)"}\n`);

    const jobs = [];

    for (const topic of topics) {
      console.log(`Queueing: ${topic.name} (${topic.slug}, type: ${topic.topic_type})`);

      const job = await ghostQueue.add(JOB_GENERATE_EVERGREEN_TOPICS, {
        curatedTopicId: topic.id,
        force,
      }, {
        jobId: `evergreen-${topic.slug}-${Date.now()}`,
      });

      jobs.push({
        slug: topic.slug,
        name: topic.name,
        jobId: job.id,
      });
    }

    console.log(`\n✅ Queued ${jobs.length} evergreen topic generation jobs`);
    console.log("\nJobs will be processed by the ghost worker. Monitor logs for progress.");

    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

generateAllEvergreenTopics();
