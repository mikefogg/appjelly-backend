import { Artifact } from "../src/models/index.js";

async function listArtifacts() {
  try {
    const artifacts = await Artifact.query()
      .withGraphFetched("[input]")
      .orderBy("created_at", "desc")
      .limit(10);

    console.log(`Found ${artifacts.length} artifacts:\n`);

    artifacts.forEach((artifact, index) => {
      console.log(`${index + 1}. ID: ${artifact.id}`);
      console.log(`   Title: ${artifact.title || 'No title'}`);
      console.log(`   Type: ${artifact.artifact_type}`);
      console.log(`   Input Prompt: ${artifact.input?.prompt ? artifact.input.prompt.substring(0, 100) + '...' : 'No input'}`);
      console.log(`   Created: ${artifact.created_at}`);
      console.log('');
    });

    if (artifacts.length > 0) {
      console.log(`To test story generation, use:`);
      console.log(`dev node scripts/generate-story-from-artifact.js ${artifacts[0].id}`);
    }

  } catch (error) {
    console.error("Error listing artifacts:", error);
    throw error;
  }
}

// Run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  listArtifacts()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed:", error.message);
      process.exit(1);
    });
}

export { listArtifacts };