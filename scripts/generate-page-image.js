#!/usr/bin/env node

import { ArtifactPage } from "#src/models/index.js";
import { queuePageImageGeneration } from "#src/background/queues/image-queue.js";

/**
 * Generate image for a specific story page
 * Usage: dev node scripts/generate-page-image.js [pageId]
 */

async function generatePageImage() {
  try {
    const pageId = process.argv[2];

    if (!pageId) {
      console.log("❌ Page ID required");
      console.log("Usage: dev node scripts/generate-page-image.js [pageId]");
      process.exit(1);
    }

    console.log(`🖼️ Generating image for page ${pageId}...`);

    // Get the page with artifact info
    const page = await ArtifactPage.query()
      .findById(pageId)
      .withGraphFetched("[artifact.actors]");

    if (!page) {
      console.log(`❌ Page ${pageId} not found`);
      process.exit(1);
    }

    console.log(`✅ Found page ${page.page_number} from artifact "${page.artifact?.title || 'Untitled'}"`);
    console.log(`   Current status: ${page.image_status || 'pending'}`);
    console.log(`   Characters: ${page.artifact?.actors?.length || 0}`);
    
    if (page.image_prompt) {
      console.log(`   Prompt: "${page.image_prompt.substring(0, 100)}..."`);
    } else {
      console.log(`❌ No image prompt found for this page`);
      process.exit(1);
    }

    // Queue the page image generation job
    const job = await queuePageImageGeneration(pageId, page.artifact_id, {
      priority: 10, // High priority
      delay: 1000   // 1 second delay
    });

    console.log(`✅ Queued page image generation job ${job.id}`);
    console.log(`🔄 Processing will: use character continuity → generate page image`);

    process.exit(0);

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Allow running from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  generatePageImage()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed:", error.message);
      process.exit(1);
    });
}