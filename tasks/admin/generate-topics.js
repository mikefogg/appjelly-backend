/**
 * Admin Task: Generate/Update Curated Topics
 *
 * Reads curated-topics.json and syncs to database
 * - Creates new topics if they don't exist (by slug)
 * - Updates existing topics (name, description, twitter_list_id, topic_type)
 * - Sets twitter_list_id to null for evergreen topics (no list needed)
 *
 * Usage: node tasks/admin/generate-topics.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import CuratedTopic from "#src/models/CuratedTopic.js";
import { knex } from "#src/models/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateTopics() {
  try {
    console.log("[Generate Topics] Starting...");

    // Read the JSON file
    const jsonPath = path.join(__dirname, "../../data/curated-topics.json");
    const jsonData = fs.readFileSync(jsonPath, "utf8");
    const topics = JSON.parse(jsonData);

    console.log(`[Generate Topics] Found ${topics.length} topics in JSON file`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Process each topic
    for (const topicData of topics) {
      const { slug, name, description, twitter_list_id, topic_type } = topicData;

      // Check if topic exists
      const existingTopic = await CuratedTopic.query()
        .where("slug", slug)
        .first();

      if (existingTopic) {
        // Update existing topic
        const hasChanges =
          existingTopic.name !== name ||
          existingTopic.description !== description ||
          existingTopic.twitter_list_id !== twitter_list_id ||
          existingTopic.topic_type !== topic_type;

        if (hasChanges) {
          await CuratedTopic.query()
            .where("id", existingTopic.id)
            .patch({
              name,
              description,
              twitter_list_id,
              topic_type,
              updated_at: new Date().toISOString(),
            });

          console.log(`[Generate Topics] ✓ Updated: ${slug} (${name})`);
          updated++;
        } else {
          console.log(`[Generate Topics] - Skipped: ${slug} (no changes)`);
          skipped++;
        }
      } else {
        // Create new topic
        await CuratedTopic.query().insert({
          slug,
          name,
          description,
          twitter_list_id,
          topic_type: topic_type || 'realtime',
          is_active: true,
        });

        console.log(`[Generate Topics] ✓ Created: ${slug} (${name})`);
        created++;
      }
    }

    console.log("\n[Generate Topics] Summary:");
    console.log(`  Created: ${created}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Total:   ${topics.length}`);

    // List topics ready for sync (have twitter_list_id)
    const readyTopics = await CuratedTopic.getTopicsReadyForSync();
    console.log(`\n[Generate Topics] Topics ready for sync: ${readyTopics.length}`);

    if (readyTopics.length > 0) {
      console.log("  Ready topics:");
      readyTopics.forEach(t => {
        console.log(`    - ${t.slug} (${t.name}) → List ID: ${t.twitter_list_id}`);
      });
    } else {
      console.log("  ⚠️  No topics have twitter_list_id set yet");
      console.log("  💡 Add twitter_list_id to curated-topics.json and run this script again");
    }

    console.log("\n[Generate Topics] ✅ Done!");

  } catch (error) {
    console.error("[Generate Topics] ❌ Error:", error);
    throw error;
  } finally {
    // Close database connection
    await knex.destroy();
  }
}

// Run the task
generateTopics();
