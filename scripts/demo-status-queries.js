import { Artifact } from "../src/models/index.js";

async function demoStatusQueries() {
  try {
    console.log("🔍 Demonstrating efficient status-based queries...\n");

    // These queries now use indexed status field instead of JSONB metadata
    const pending = await Artifact.pending().select("id", "title", "status", "created_at");
    const generating = await Artifact.generating().select("id", "title", "status", "created_at");
    const completed = await Artifact.completed().select("id", "title", "status", "created_at");
    const failed = await Artifact.failed().select("id", "title", "status", "created_at");

    console.log("📊 Status Summary:");
    console.log(`- Pending: ${pending.length}`);
    console.log(`- Generating: ${generating.length}`);
    console.log(`- Completed: ${completed.length}`);
    console.log(`- Failed: ${failed.length}\n`);

    if (generating.length > 0) {
      console.log("⏳ Currently Generating:");
      generating.forEach(artifact => {
        console.log(`  - ${artifact.title} (${artifact.id})`);
      });
      console.log();
    }

    if (completed.length > 0) {
      console.log("✅ Recently Completed (last 5):");
      const recent = completed.slice(-5);
      recent.forEach(artifact => {
        console.log(`  - ${artifact.title} (${artifact.created_at})`);
      });
      console.log();
    }

    if (failed.length > 0) {
      console.log("❌ Failed:");
      failed.forEach(artifact => {
        console.log(`  - ${artifact.title} (${artifact.id})`);
      });
      console.log();
    }

    // Demonstrate efficient composite query (uses composite index)
    console.log("🚀 Performance Comparison:");
    console.log("OLD (slow): SELECT * FROM artifacts WHERE metadata->>'status' = 'completed'");
    console.log("NEW (fast): SELECT * FROM artifacts WHERE status = 'completed' (indexed!)");
    console.log();

    // Show the SQL that would be generated for efficient queries
    console.log("📝 Efficient query examples:");
    console.log("- Get all pending stories: Artifact.pending()");
    console.log("- Get stories being generated: Artifact.generating()");
    console.log("- Get completed stories from last week: Artifact.completed().where('created_at', '>', weekAgo)");
    console.log("- Count by status: Artifact.byStatus('completed').count()");

  } catch (error) {
    console.error("Error running status queries:", error);
    throw error;
  }
}

// Allow running from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  demoStatusQueries()
    .then(() => {
      console.log("\n✅ Status query demo completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed:", error.message);
      process.exit(1);
    });
}

export { demoStatusQueries };