/**
 * Admin Task: Hydrate Evergreen Topics
 *
 * Generates evergreen topics for all evergreen curated topics
 * This is a one-time hydration task - run after initial setup
 *
 * Usage: node tasks/admin/hydrate-evergreen-topics.js
 */

import { CuratedTopic } from "#src/models/index.js";
import { knex } from "#src/models/index.js";
import generateEvergreenTopicsJob from "#src/background/jobs/ghost/generate-evergreen-topics.js";

async function hydrateEvergreenTopics() {
  try {
    console.log("[Hydrate Evergreen Topics] Starting...\n");

    // Get all evergreen topics
    const evergreenTopics = await CuratedTopic.getEvergreenTopics();

    if (evergreenTopics.length === 0) {
      console.log("[Hydrate Evergreen Topics] ⚠️  No evergreen topics found");
      console.log("  💡 Make sure topic_type='evergreen' is set in curated_topics table");
      return;
    }

    console.log(`[Hydrate Evergreen Topics] Found ${evergreenTopics.length} evergreen topics:\n`);
    evergreenTopics.forEach(t => {
      console.log(`  - ${t.slug} (${t.name})`);
    });
    console.log("");

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    // Process each evergreen topic
    for (const topic of evergreenTopics) {
      console.log(`\n[Hydrate Evergreen Topics] Processing: ${topic.name} (${topic.slug})`);
      console.log("─".repeat(60));

      try {
        // Call the job directly (simulating BullMQ job structure)
        const result = await generateEvergreenTopicsJob({
          data: { curatedTopicId: topic.id }
        });

        if (result.success) {
          if (result.message === 'Already have sufficient evergreen topics') {
            console.log(`✓ Skipped (already has ${result.count} topics)`);
            skipped++;
          } else {
            console.log(`✓ Generated ${result.topicsGenerated} topics`);
            console.log(`  Rotation groups distribution:`);
            Object.entries(result.rotationGroups).forEach(([day, count]) => {
              console.log(`    Day ${day}: ${count} topics`);
            });
            generated++;
          }
        }
      } catch (error) {
        console.error(`✗ Failed: ${error.message}`);
        failed++;
      }
    }

    console.log("\n" + "═".repeat(60));
    console.log("[Hydrate Evergreen Topics] Summary:");
    console.log(`  Generated: ${generated}`);
    console.log(`  Skipped:   ${skipped}`);
    console.log(`  Failed:    ${failed}`);
    console.log(`  Total:     ${evergreenTopics.length}`);
    console.log("═".repeat(60));

    if (generated > 0) {
      console.log("\n✅ Evergreen topics successfully hydrated!");
      console.log("   These topics will rotate daily based on day of week (1-7)");
    } else if (skipped === evergreenTopics.length) {
      console.log("\n✅ All evergreen topics already hydrated!");
    } else {
      console.log("\n⚠️  Some topics failed to generate - check errors above");
    }

  } catch (error) {
    console.error("[Hydrate Evergreen Topics] ❌ Error:", error);
    throw error;
  } finally {
    // Close database connection
    await knex.destroy();
  }
}

// Run the task
hydrateEvergreenTopics();
