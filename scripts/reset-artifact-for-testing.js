import { Artifact, ArtifactPage } from "../src/models/index.js";

async function resetArtifactForTesting(artifactId) {
  try {
    console.log(`🔄 Resetting artifact ${artifactId} for testing...`);

    await Artifact.transaction(async (trx) => {
      // Reset artifact to initial state
      await Artifact.query(trx)
        .findById(artifactId)
        .patch({
          title: "Story - " + new Date().toLocaleDateString(),
          subtitle: null,
          description: null,
          total_tokens: null,
          plotline_tokens: null,
          story_tokens: null,
          plotline_prompt_tokens: null,
          plotline_completion_tokens: null,
          story_prompt_tokens: null,
          story_completion_tokens: null,
          cost_usd: null,
          generation_time_seconds: null,
          ai_model: null,
          ai_provider: null,
          metadata: {
            status: "generating",
            started_at: new Date().toISOString(),
          },
        });

      // Delete existing pages
      await ArtifactPage.query(trx)
        .where("artifact_id", artifactId)
        .delete();
    });

    console.log(`✅ Artifact reset successfully!`);
    console.log(`- Status: generating`);
    console.log(`- Title reset to default`);
    console.log(`- All pages deleted`);
    console.log(`- Token tracking fields cleared`);

  } catch (error) {
    console.error("Error resetting artifact:", error);
    throw error;
  }
}

// Allow running from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  const artifactId = process.argv[2];
  
  if (!artifactId) {
    console.error("Usage: dev node scripts/reset-artifact-for-testing.js <artifact-id>");
    console.error("Example: dev node scripts/reset-artifact-for-testing.js 123e4567-e89b-12d3-a456-426614174000");
    process.exit(1);
  }

  resetArtifactForTesting(artifactId)
    .then(() => {
      console.log("\nArtifact reset! Now you can test background job generation.");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed:", error.message);
      process.exit(1);
    });
}

export { resetArtifactForTesting };