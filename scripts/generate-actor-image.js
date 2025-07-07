#!/usr/bin/env node

import { Actor } from "#src/models/index.js";
import { queueActorImageProcessing } from "#src/background/queues/image-queue.js";

/**
 * Generate character continuity and avatar for a specific actor
 * Usage: dev node scripts/generate-actor-image.js [actorId] [imageKey]
 */

async function generateActorImage() {
  try {
    const actorId = process.argv[2];
    const imageKey = process.argv[3];

    if (!actorId) {
      console.log("❌ Actor ID required");
      console.log("Usage: dev node scripts/generate-actor-image.js [actorId] [imageKey]");
      process.exit(1);
    }

    if (!imageKey) {
      console.log("❌ Image key required");
      console.log("Usage: dev node scripts/generate-actor-image.js [actorId] [imageKey]");
      process.exit(1);
    }

    console.log(`🎨 Generating character image for actor ${actorId}...`);

    // Get the actor
    const actor = await Actor.query()
      .findById(actorId)
      .withGraphFetched("[media]");

    if (!actor) {
      console.log(`❌ Actor ${actorId} not found`);
      process.exit(1);
    }

    console.log(`✅ Found actor: ${actor.name} (${actor.type})`);
    console.log(`   Current status: ${actor.image_status || 'pending'}`);

    // Queue the image processing job
    const job = await queueActorImageProcessing(actorId, imageKey, {
      priority: 10, // High priority
      delay: 1000   // 1 second delay
    });

    console.log(`✅ Queued image processing job ${job.id} for ${actor.name}`);
    console.log(`🔄 Processing will: analyze image → create continuity → generate avatar`);

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Allow running from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  generateActorImage()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed:", error.message);
      process.exit(1);
    });
}