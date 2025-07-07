import { Artifact } from "#src/models/index.js";
import storyCreationService from "#src/helpers/snugglebug/story-creation-service.js";

export default async function generateStoryJob(job) {
  const { inputId, artifactId, regenerate = false } = job.data;

  try {
    const mode = regenerate ? "REGENERATION" : "INITIAL GENERATION";
    console.log(`[Generate Story] Processing ${mode} job for artifact ${artifactId}`);

    // Get the artifact with input and actors
    let artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched("[input, actors]");
      
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    if (!artifact.input) {
      throw new Error(`Artifact ${artifactId} has no associated input`);
    }

    console.log(`[Generate Story] Found input: "${artifact.input.prompt}"`);
    console.log(`[Generate Story] Found ${artifact.actors.length} actors`);
    console.log(`[Generate Story] Current status: ${artifact.status}`);
    
    // Validate regeneration request
    if (regenerate && artifact.status !== "completed") {
      console.log(`[Generate Story] Warning: Regenerating artifact with status "${artifact.status}" (expected "completed")`);
    }
    
    if (!regenerate && artifact.status === "completed") {
      console.log(`[Generate Story] Warning: Initial generation for already completed artifact (should use regenerate=true)`);
    }

    // For regeneration: Completely reset the artifact and delete existing pages
    if (regenerate) {
      console.log(`[Generate Story] Resetting artifact for regeneration...`);
      
      await Artifact.transaction(async (trx) => {
        // Delete all existing pages first
        await artifact.$relatedQuery("pages", trx).delete();
        console.log(`[Generate Story] Deleted existing pages`);
        
        // Reset artifact fields to initial state
        await artifact.$query(trx).patch({
          status: "generating",
          title: null,
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
            ...artifact.metadata,
            processing_started_at: new Date().toISOString(),
            regenerate: true,
            generation_count: (artifact.metadata?.generation_count || 0) + 1,
            // Clear previous generation data
            completed_at: null,
            plotline: null,
            character_json: null,
          },
        });
        console.log(`[Generate Story] Reset artifact fields to initial state`);
      });
      
      // Reload artifact after reset
      artifact = await Artifact.query()
        .findById(artifactId)
        .withGraphFetched("[input, actors]");
    } else {
      // For initial generation: Just update status to generating
      artifact = await artifact.$query().patchAndFetch({
        status: "generating",
        metadata: {
          ...artifact.metadata,
          processing_started_at: new Date().toISOString(),
          regenerate: false,
          generation_count: (artifact.metadata?.generation_count || 0) + 1,
        },
      });
    }

    // Generate the story using our service
    console.log(`[Generate Story] Starting AI generation...`);
    const generationResult = await storyCreationService.generateStoryFromInput(
      artifact.input,
      artifact.actors
    );

    // Save the story to the artifact within a transaction
    console.log(`[Generate Story] Saving generated story...`);
    const updatedArtifact = await Artifact.transaction(async (trx) => {
      return await storyCreationService.saveStoryToArtifact(
        artifactId,
        generationResult,
        trx
      );
    });

    const generationCount = updatedArtifact.metadata?.generation_count || 1;
    const generationType = regenerate ? "regenerated" : "generated";
    
    console.log(
      `[Generate Story] Successfully ${generationType} "${updatedArtifact.title}" with ${updatedArtifact.pages.length} pages (generation #${generationCount})`
    );
    console.log(`[Generate Story] Token usage: ${updatedArtifact.total_tokens}, Cost: $${parseFloat(updatedArtifact.cost_usd).toFixed(4)}`);

    return { 
      success: true, 
      artifactId: artifact.id,
      title: updatedArtifact.title,
      pages: updatedArtifact.pages.length,
      tokens: updatedArtifact.total_tokens,
      cost: parseFloat(updatedArtifact.cost_usd),
      regenerate: regenerate,
      generation_count: generationCount
    };
  } catch (error) {
    console.error(
      `[Generate Story] Error processing job for artifact ${artifactId}:`,
      error
    );

    // Update artifact with error status
    if (artifactId) {
      try {
        const failedArtifact = await Artifact.query().findById(artifactId);
        if (failedArtifact) {
          await failedArtifact.markAsFailed(error);
          console.log(`[Generate Story] Updated artifact ${artifactId} status to failed`);
        }
      } catch (updateError) {
        console.error(
          `[Generate Story] Failed to update artifact status:`,
          updateError
        );
      }
    }

    throw error;
  }
}
