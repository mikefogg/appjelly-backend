import { Input, Actor } from "../src/models/index.js";
import storyCreationService from "../src/helpers/snugglebug/story-creation-service.js";

async function generateStoryFromInputId(inputId) {
  try {
    // Fetch the input with its associated actors
    const input = await Input.query()
      .findById(inputId)
      .withGraphFetched("[actors]");

    if (!input) {
      throw new Error(`Input with ID ${inputId} not found`);
    }

    console.log("Found input:", input.prompt);
    console.log("Number of actors:", input.actors.length);

    // Generate the story
    const result = await storyCreationService.generateStoryFromInput(
      input,
      input.actors
    );

    return result;
  } catch (error) {
    console.error("Error generating story:", error);
    throw error;
  }
}

// Allow running from command line with input ID
if (import.meta.url === `file://${process.argv[1]}`) {
  const inputId = process.argv[2];
  
  if (!inputId) {
    console.error("Usage: node scripts/generate-story-from-input.js <input-id>");
    console.error("Example: node scripts/generate-story-from-input.js 123e4567-e89b-12d3-a456-426614174000");
    process.exit(1);
  }

  generateStoryFromInputId(inputId)
    .then(() => {
      console.log("\nStory generation completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\nFailed:", error.message);
      process.exit(1);
    });
}

export { generateStoryFromInputId };