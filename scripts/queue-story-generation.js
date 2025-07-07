import { Artifact } from "../src/models/index.js";
import { contentQueue, JOB_GENERATE_STORY } from "../src/background/queues/index.js";

async function queueStoryGeneration(artifactId, options = {}) {
  try {
    const { regenerate = false, runNow = false, skipImages = false } = options;
    
    // Verify the artifact exists and get basic info
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched("[input, actors]");

    if (!artifact) {
      throw new Error(`Artifact with ID ${artifactId} not found`);
    }

    if (!artifact.input) {
      throw new Error(`Artifact ${artifactId} has no associated input`);
    }

    console.log("Found artifact:", artifact.title || "Untitled");
    console.log("Input prompt:", artifact.input.prompt);
    console.log("Number of actors:", artifact.actors.length);
    console.log("Current status:", artifact.status || "unknown");
    
    // Check if regeneration is appropriate
    if (regenerate) {
      if (artifact.status !== "completed") {
        console.log("⚠️  Warning: Regenerating an artifact that isn't completed");
      }
      console.log("🔄 Mode: REGENERATION");
    } else {
      if (artifact.status === "completed") {
        console.log("⚠️  Warning: Generating for an already completed artifact (use --regenerate flag)");
      }
      console.log("✨ Mode: INITIAL GENERATION");
    }

    if (runNow) {
      console.log("⚡ Execution: RUN NOW (synchronous)");
      
      // Import the story creation service directly (skip the job wrapper)
      const storyCreationService = (await import("../src/helpers/snugglebug/story-creation-service.js")).default;
      
      console.log("\n⚡ Running story generation immediately...");
      
      // Update artifact status to generating
      const updatedArtifact = await artifact.$query().patchAndFetch({
        status: "generating",
        metadata: {
          ...artifact.metadata,
          processing_started_at: new Date().toISOString(),
          regenerate: regenerate,
          generation_count: (artifact.metadata?.generation_count || 0) + 1,
        },
      });
      
      // Generate the story directly
      const generationResult = await storyCreationService.generateStoryFromInput(
        artifact.input,
        artifact.actors
      );
      
      // Save the story to the artifact
      const finalArtifact = await Artifact.transaction(async (trx) => {
        return await storyCreationService.saveStoryToArtifact(
          artifactId,
          generationResult,
          trx,
          { skipImageGeneration: skipImages }
        );
      });
      
      const generationCount = finalArtifact.metadata?.generation_count || 1;
      const generationType = regenerate ? "regenerated" : "generated";
      
      console.log(`\n✅ Story generation completed immediately!`);
      console.log(`- Successfully ${generationType} "${finalArtifact.title}" with ${finalArtifact.pages.length} pages (generation #${generationCount})`);
      console.log(`- Token usage: ${finalArtifact.total_tokens}, Cost: $${parseFloat(finalArtifact.cost_usd).toFixed(4)}`);
      
      const result = {
        success: true,
        artifactId: artifactId,
        title: finalArtifact.title,
        pages: finalArtifact.pages.length,
        tokens: finalArtifact.total_tokens,
        cost: parseFloat(finalArtifact.cost_usd),
        regenerate: regenerate,
        generation_count: generationCount
      };
      
      return { job: null, artifact: finalArtifact, result, runNow: true };
    }

    // Queue the story generation job with regenerate flag
    console.log("📋 Execution: QUEUED (asynchronous)");
    console.log("\n📋 Queueing story generation job...");
    
    const job = await contentQueue.add(
      JOB_GENERATE_STORY,
      {
        inputId: artifact.input.id,
        artifactId: artifact.id,
        regenerate: regenerate,
        skipImageGeneration: skipImages,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: 50,
        removeOnFail: 50,
      }
    );

    console.log(`✅ Job queued successfully!`);
    console.log(`- Job ID: ${job.id}`);
    console.log(`- Queue: ${contentQueue.name}`);
    console.log(`- Artifact ID: ${artifactId}`);
    console.log(`- Input ID: ${artifact.input.id}`);
    console.log(`- Regenerate: ${regenerate}`);

    console.log(`\n🔍 To monitor the job:`);
    console.log(`- Check the content worker logs`);
    console.log(`- Job will update artifact status to "generating" then "completed"`);
    console.log(`- Story pages will be created when complete`);

    return { job, artifact, result: null, runNow: false };
  } catch (error) {
    console.error("Error queueing story generation:", error);
    throw error;
  }
}

// Allow running from command line with artifact ID
if (import.meta.url === `file://${process.argv[1]}`) {
  const artifactId = process.argv[2];
  const regenerateFlag = process.argv.includes("--regenerate") || process.argv.includes("-r");
  const runNowFlag = process.argv.includes("--run-now") || process.argv.includes("--now");
  const skipImagesFlag = process.argv.includes("--skip-images");
  
  if (!artifactId) {
    console.error("Usage: dev node scripts/queue-story-generation.js <artifact-id> [flags]");
    console.error("\nExamples:");
    console.error("  dev node scripts/queue-story-generation.js 123e4567-e89b-12d3-a456-426614174000");
    console.error("  dev node scripts/queue-story-generation.js 123e4567-e89b-12d3-a456-426614174000 --regenerate");
    console.error("  dev node scripts/queue-story-generation.js 123e4567-e89b-12d3-a456-426614174000 --regenerate --skip-images");
    console.error("  dev node scripts/queue-story-generation.js 123e4567-e89b-12d3-a456-426614174000 --run-now");
    console.error("  dev node scripts/queue-story-generation.js 123e4567-e89b-12d3-a456-426614174000 --regenerate --run-now");
    console.error("\nFlags:");
    console.error("  --regenerate, -r   Regenerate an existing story (creates new version)");
    console.error("  --run-now, --now   Run immediately instead of queueing (no worker needed)");
    console.error("  --skip-images      Skip image generation (story text only)");
    console.error("\nExecution modes:");
    console.error("  Default: Queues background job (requires content worker running)");
    console.error("  --run-now: Runs synchronously in current process (faster for testing)");
    process.exit(1);
  }

  queueStoryGeneration(artifactId, { 
    regenerate: regenerateFlag,
    runNow: runNowFlag,
    skipImages: skipImagesFlag
  })
    .then((result) => {
      if (result.runNow) {
        console.log("\n✅ Story generation completed immediately!");
      } else {
        console.log("\n📋 Job queued successfully! Check the content worker to see it process.");
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error("\nFailed:", error.message);
      process.exit(1);
    });
}

export { queueStoryGeneration };