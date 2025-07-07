#!/usr/bin/env node

import { mediaQueue } from "#src/background/queues/index.js";

/**
 * Clear stuck jobs from the media queue
 * Usage: dev node scripts/clear-queue.js
 */

async function clearQueue() {
  try {
    console.log("🧹 Clearing stuck jobs from media queue...");

    // Get all jobs
    const [waiting, active, failed, delayed] = await Promise.all([
      mediaQueue.getWaiting(),
      mediaQueue.getActive(),
      mediaQueue.getFailed(),
      mediaQueue.getDelayed(),
    ]);

    console.log(`Found ${waiting.length} waiting, ${active.length} active, ${failed.length} failed, ${delayed.length} delayed jobs`);

    // Clean up all jobs
    await mediaQueue.clean(0, 100, 'completed');
    await mediaQueue.clean(0, 100, 'failed');
    await mediaQueue.clean(0, 100, 'active'); 
    await mediaQueue.clean(0, 100, 'waiting');

    console.log("✅ Queue cleared!");

    await mediaQueue.close();

  } catch (error) {
    console.error("❌ Error clearing queue:", error.message);
    process.exit(1);
  }
}

// Allow running from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  clearQueue()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed:", error.message);
      process.exit(1);
    });
}