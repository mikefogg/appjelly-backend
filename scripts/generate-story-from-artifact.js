import { Artifact } from "../src/models/index.js";
import storyCreationService from "../src/helpers/snugglebug/story-creation-service.js";

async function generateStoryFromArtifactId(artifactId) {
  try {
    // Fetch the artifact with its input and actors
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched("[input, actors]");

    if (!artifact) {
      throw new Error(`Artifact with ID ${artifactId} not found`);
    }

    if (!artifact.input) {
      throw new Error(`Artifact ${artifactId} has no associated input`);
    }

    console.log("Found artifact:", artifact.title);
    console.log("Input prompt:", artifact.input.prompt);
    console.log("Number of actors:", artifact.actors.length);

    // Generate the story
    const result = await storyCreationService.generateStoryFromInput(
      artifact.input,
      artifact.actors
    );

    // Save the story to the artifact (this would normally be done by the background job)
    console.log("\n📝 Saving story to artifact pages...");
    const updatedArtifact = await storyCreationService.saveStoryToArtifact(
      artifactId,
      result
    );

    console.log(`\n✅ Story saved! ${updatedArtifact.pages.length} pages created.`);
    console.log(`\nArtifact updated with:`);
    console.log(`- Title: ${updatedArtifact.title}`);
    console.log(`- Subtitle: ${updatedArtifact.subtitle}`);
    console.log(`- Description: ${updatedArtifact.description}`);
    console.log(`- Status: ${updatedArtifact.metadata.status}`);
    console.log(`- Total tokens: ${updatedArtifact.total_tokens}`);
    console.log(`- Cost: $${parseFloat(updatedArtifact.cost_usd).toFixed(4)}`);
    console.log(`- Generation time: ${parseFloat(updatedArtifact.generation_time_seconds).toFixed(2)}s`);
    console.log(`- AI Model: ${updatedArtifact.ai_model}`);
    console.log(`- AI Provider: ${updatedArtifact.ai_provider}`);
    
    console.log(`\nPage structure:`);
    updatedArtifact.pages.forEach((page, index) => {
      console.log(`- Page ${page.page_number}: ${page.layout_data.text.length} text segments, image_status: ${page.image_status}`);
    });

    return { result, updatedArtifact };
  } catch (error) {
    console.error("Error generating story:", error);
    throw error;
  }
}

// Allow running from command line with artifact ID
if (import.meta.url === `file://${process.argv[1]}`) {
  const artifactId = process.argv[2];
  
  if (!artifactId) {
    console.error("Usage: node scripts/generate-story-from-artifact.js <artifact-id>");
    console.error("Example: node scripts/generate-story-from-artifact.js 123e4567-e89b-12d3-a456-426614174000");
    process.exit(1);
  }

  generateStoryFromArtifactId(artifactId)
    .then(() => {
      console.log("\nStory generation completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\nFailed:", error.message);
      process.exit(1);
    });
}

export { generateStoryFromArtifactId };