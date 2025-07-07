#!/usr/bin/env node

import { mediaQueue } from "#src/background/queues/index.js";

/**
 * Check queue status and job details
 * Usage: dev node scripts/check-queue-status.js [jobId]
 */

async function checkQueueStatus() {
  try {
    const jobId = process.argv[2];

    console.log("📊 Media Queue Status:");
    
    // Get queue counts
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      mediaQueue.getWaiting(),
      mediaQueue.getActive(),
      mediaQueue.getCompleted(),
      mediaQueue.getFailed(),
      mediaQueue.getDelayed(),
    ]);

    console.log(`   Waiting: ${waiting.length}`);
    console.log(`   Active: ${active.length}`);
    console.log(`   Completed: ${completed.length}`);
    console.log(`   Failed: ${failed.length}`);
    console.log(`   Delayed: ${delayed.length}`);

    // Show recent jobs
    if (waiting.length > 0) {
      console.log("\n⏳ Waiting Jobs:");
      waiting.slice(0, 5).forEach(job => {
        console.log(`   ${job.id}: ${job.name} (priority: ${job.opts.priority || 0})`);
      });
    }

    if (active.length > 0) {
      console.log("\n🏃 Active Jobs:");
      active.forEach(job => {
        console.log(`   ${job.id}: ${job.name} (progress: ${job.progress || 0}%)`);
      });
    }

    if (delayed.length > 0) {
      console.log("\n⏰ Delayed Jobs:");
      delayed.slice(0, 5).forEach(job => {
        const delay = job.opts.delay || 0;
        const now = Date.now();
        const scheduled = job.timestamp + delay;
        const remainingMs = scheduled - now;
        const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
        console.log(`   ${job.id}: ${job.name} (in ${remainingSec}s)`);
      });
    }

    if (failed.length > 0) {
      console.log("\n❌ Recent Failed Jobs:");
      failed.slice(0, 3).forEach(job => {
        console.log(`   ${job.id}: ${job.name} - ${job.failedReason}`);
      });
    }

    // Check specific job if provided
    if (jobId) {
      console.log(`\n🔍 Job ${jobId} Details:`);
      const job = await mediaQueue.getJob(jobId);
      if (job) {
        console.log(`   Name: ${job.name}`);
        console.log(`   Status: ${await job.getState()}`);
        console.log(`   Progress: ${job.progress || 0}%`);
        console.log(`   Data:`, JSON.stringify(job.data, null, 2));
        if (job.failedReason) {
          console.log(`   Failed Reason: ${job.failedReason}`);
        }
        if (job.returnvalue) {
          console.log(`   Return Value:`, JSON.stringify(job.returnvalue, null, 2));
        }
      } else {
        console.log(`   Job not found`);
      }
    }

    await mediaQueue.close();

  } catch (error) {
    console.error("❌ Error checking queue:", error.message);
    process.exit(1);
  }
}

// Allow running from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  checkQueueStatus()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed:", error.message);
      process.exit(1);
    });
}