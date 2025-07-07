import storyCreationService from "../src/helpers/snugglebug/story-creation-service.js";

// Mock input and actors data for testing
const mockInput = {
  id: "test-input-1",
  prompt: "Ava and her family go on a rainy morning adventure to get donuts. They have to dodge puddles and thunder on their way to the donut shop, where Ava picks the perfect pink donut with sprinkles.",
  metadata: {
    tone: "playful",
    setting: "urban",
  },
};

const mockActors = [
  {
    id: "actor-1",
    name: "Ava",
    type: "child",
    metadata: {
      isMainCharacter: true,
      interests: ["unicorns", "magic", "tiny things"],
    },
  },
  {
    id: "actor-2",
    name: "Dad",
    type: "adult",
    metadata: {},
  },
  {
    id: "actor-3",
    name: "Mom",
    type: "adult",
    metadata: {},
  },
  {
    id: "actor-4",
    name: "Ella",
    type: "infant",
    metadata: {},
  },
];

async function testStoryGeneration() {
  console.log("Starting story generation test...\n");
  console.log("Input prompt:", mockInput.prompt);
  console.log("\nActors:");
  mockActors.forEach((actor) => {
    console.log(
      `- ${actor.name} (${actor.type})${
        actor.metadata.isMainCharacter ? " [Main Character]" : ""
      }`
    );
  });
  console.log("\n" + "=".repeat(50) + "\n");

  try {
    const result = await storyCreationService.generateStoryFromInput(
      mockInput,
      mockActors
    );

    // The service already logs the story and usage info
    // Just add a success message
    console.log("\n✅ Story generation completed successfully!");
    
    // Return the result for potential further use
    return result;
  } catch (error) {
    console.error("\n❌ Story generation failed:", error.message);
    throw error;
  }
}

// Run the test if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testStoryGeneration()
    .then(() => {
      console.log("\nTest completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\nTest failed:", error);
      process.exit(1);
    });
}

export { testStoryGeneration };