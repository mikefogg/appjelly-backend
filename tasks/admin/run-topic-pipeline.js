/**
 * Admin Task: Run Topic Pipeline
 *
 * Runs the full topic processing pipeline for immediate testing/updates
 * - For realtime/hybrid topics: sync from Twitter + digest into trending topics
 * - For evergreen topics: generate new AI-powered topics
 *
 * Usage:
 *   node tasks/admin/run-topic-pipeline.js                    # All realtime topics
 *   node tasks/admin/run-topic-pipeline.js --slug=ai          # Specific topic
 *   node tasks/admin/run-topic-pipeline.js --type=realtime    # All realtime
 *   node tasks/admin/run-topic-pipeline.js --type=evergreen   # All evergreen
 *   node tasks/admin/run-topic-pipeline.js --type=hybrid      # All hybrid
 *   node tasks/admin/run-topic-pipeline.js --all              # ALL topics (realtime, hybrid, evergreen)
 */

import { CuratedTopic } from "#src/models/index.js";
import { knex } from "#src/models/index.js";
import syncCuratedTopicJob from "#src/background/jobs/ghost/sync-curated-topic.js";
import digestRecentTopicsJob from "#src/background/jobs/ghost/digest-recent-topics.js";
import generateEvergreenTopicsJob from "#src/background/jobs/ghost/generate-evergreen-topics.js";

// Parse command line arguments
const args = process.argv.slice(2);
const slugArg = args.find(arg => arg.startsWith('--slug='))?.split('=')[1];
const typeArg = args.find(arg => arg.startsWith('--type='))?.split('=')[1];
const allFlag = args.includes('--all');

async function runTopicPipeline() {
  try {
    console.log("═".repeat(70));
    console.log("               RUN TOPIC PIPELINE");
    console.log("═".repeat(70));
    console.log("");

    // Determine which topics to process
    let topics;

    if (slugArg) {
      // Specific topic by slug
      const topic = await CuratedTopic.query()
        .where('slug', slugArg)
        .where('is_active', true)
        .first();

      if (!topic) {
        console.log(`❌ Topic with slug "${slugArg}" not found or not active`);
        return;
      }

      topics = [topic];
      console.log(`📌 Running pipeline for specific topic: ${topic.name} (${topic.slug})`);
    } else if (allFlag) {
      // All active topics
      topics = await CuratedTopic.query()
        .where('is_active', true)
        .orderBy('topic_type')
        .orderBy('name');

      console.log(`📌 Running pipeline for ALL ${topics.length} active topics`);
    } else if (typeArg) {
      // Filter by topic_type
      const validTypes = ['realtime', 'evergreen', 'hybrid'];
      if (!validTypes.includes(typeArg)) {
        console.log(`❌ Invalid type: ${typeArg}`);
        console.log(`   Valid types: ${validTypes.join(', ')}`);
        return;
      }

      topics = await CuratedTopic.query()
        .where('is_active', true)
        .where('topic_type', typeArg)
        .orderBy('name');

      console.log(`📌 Running pipeline for ${topics.length} ${typeArg} topics`);
    } else {
      // Default: realtime topics only
      topics = await CuratedTopic.query()
        .where('is_active', true)
        .whereIn('topic_type', ['realtime', 'hybrid'])
        .whereNotNull('twitter_list_id')
        .orderBy('name');

      console.log(`📌 Running pipeline for ${topics.length} realtime topics (default)`);
      console.log(`   💡 Use --type=evergreen or --all to process other types`);
    }

    if (topics.length === 0) {
      console.log("\n⚠️  No topics found matching criteria");
      return;
    }

    console.log("\nTopics to process:");
    topics.forEach(t => {
      console.log(`  - ${t.slug.padEnd(20)} (${t.name}) [${t.topic_type}]`);
    });
    console.log("");

    let realtimeCount = 0;
    let evergreenCount = 0;
    let failedCount = 0;

    // Process each topic
    for (const topic of topics) {
      console.log("\n" + "─".repeat(70));
      console.log(`Processing: ${topic.name} (${topic.slug}) [${topic.topic_type}]`);
      console.log("─".repeat(70));

      try {
        if (topic.topic_type === 'evergreen') {
          // Generate evergreen topics
          console.log(`[Evergreen] Generating AI-powered topics...`);

          const result = await generateEvergreenTopicsJob({
            data: { curatedTopicId: topic.id }
          });

          if (result.success) {
            if (result.message === 'Already have sufficient evergreen topics') {
              console.log(`✓ Skipped (already has ${result.count} topics)`);
            } else {
              console.log(`✓ Generated ${result.topicsGenerated} topics`);
              evergreenCount++;
            }
          }

        } else {
          // Realtime or Hybrid: Sync from Twitter + Digest
          if (!topic.twitter_list_id) {
            console.log(`⚠️  Skipped: No twitter_list_id configured`);
            continue;
          }

          console.log(`[Realtime] Step 1/2: Syncing from Twitter list...`);

          const syncResult = await syncCuratedTopicJob({
            data: { curatedTopicId: topic.id }
          });

          if (syncResult.success) {
            console.log(`✓ Synced ${syncResult.posts_saved} posts (${syncResult.posts_skipped} duplicates)`);

            console.log(`[Realtime] Step 2/2: Digesting into trending topics...`);

            const digestResult = await digestRecentTopicsJob({
              data: { curatedTopicId: topic.id }
            });

            if (digestResult.success) {
              console.log(`✓ Digested ${digestResult.trending_topics_found} trending topics`);
              realtimeCount++;
            } else {
              console.log(`⚠️  Digest completed with warnings`);
              realtimeCount++;
            }
          } else {
            console.log(`⚠️  Sync completed with warnings`);
          }
        }

      } catch (error) {
        console.error(`❌ Failed: ${error.message}`);
        failedCount++;
      }
    }

    // Summary
    console.log("\n" + "═".repeat(70));
    console.log("SUMMARY");
    console.log("═".repeat(70));
    console.log(`  Realtime/Hybrid processed: ${realtimeCount}`);
    console.log(`  Evergreen processed:       ${evergreenCount}`);
    console.log(`  Failed:                    ${failedCount}`);
    console.log(`  Total:                     ${topics.length}`);
    console.log("═".repeat(70));

    if (failedCount === 0) {
      console.log("\n✅ All topics processed successfully!");
    } else {
      console.log(`\n⚠️  ${failedCount} topic(s) failed - check errors above`);
    }

  } catch (error) {
    console.error("\n❌ Pipeline Error:", error);
    throw error;
  } finally {
    // Close database connection
    await knex.destroy();
  }
}

// Show usage if --help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage:
  node tasks/admin/run-topic-pipeline.js [options]

Options:
  --slug=<slug>     Run pipeline for specific topic (e.g., --slug=ai)
  --type=<type>     Run pipeline for topic type: realtime, evergreen, or hybrid
  --all             Run pipeline for ALL active topics
  (no options)      Run pipeline for all realtime topics (default)

Examples:
  node tasks/admin/run-topic-pipeline.js                    # All realtime topics
  node tasks/admin/run-topic-pipeline.js --slug=ai          # Just AI topic
  node tasks/admin/run-topic-pipeline.js --type=evergreen   # All evergreen topics
  node tasks/admin/run-topic-pipeline.js --all              # Everything
  `);
  await knex.destroy();
} else {
  // Run the pipeline
  await runTopicPipeline();
}
