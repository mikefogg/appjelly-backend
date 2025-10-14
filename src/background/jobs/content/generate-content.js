import { Artifact, App, Media } from "#src/models/index.js";
import snugglebugStoryService from "#src/helpers/snugglebug/story-creation-service.js";
import fursonaPetVoiceService from "#src/helpers/fursona/pet-inner-voice-service.js";
import imageAnalysisService from "#src/helpers/fursona/image-analysis-service.js";
import aiService from "#src/helpers/ai-service.js";

export default async function generateContentJob(job) {
  const {
    artifactId,
    regenerate = false,
    skipImageGeneration = false,
    appSlug,
  } = job.data;

  try {
    const mode = regenerate ? "REGENERATION" : "INITIAL GENERATION";
    console.log(
      `[Generate Content] Processing ${mode} job for artifact ${artifactId}`
    );
    console.log(`[Generate Content] App: ${appSlug}`);

    // Get the artifact with input, actors, and app
    let artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched("[input, actors, app]");

    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    if (!artifact.input) {
      throw new Error(`Artifact ${artifactId} has no associated input`);
    }

    // Use app slug from either job data or artifact's app
    const appSlugToUse = appSlug || artifact.app?.slug;
    console.log(`[Generate Content] Using app slug: ${appSlugToUse}`);
    console.log(`[Generate Content] Found input: "${artifact.input.prompt}"`);
    console.log(`[Generate Content] Found ${artifact.actors.length} actors`);
    console.log(`[Generate Content] Current status: ${artifact.status}`);

    // Validate regeneration request
    if (regenerate && artifact.status !== "completed") {
      console.log(
        `[Generate Content] Warning: Regenerating artifact with status "${artifact.status}" (expected "completed")`
      );
    }

    if (!regenerate && artifact.status === "completed") {
      console.log(
        `[Generate Content] Warning: Initial generation for already completed artifact (should use regenerate=true)`
      );
    }

    // For regeneration: Reset the artifact based on content type
    if (regenerate) {
      console.log(`[Generate Content] Resetting artifact for regeneration...`);

      // Delete all existing pages if they exist (for stories)
      await Artifact.transaction(async (trx) => {
        const existingPages = await artifact.$relatedQuery("pages", trx);
        if (existingPages.length > 0) {
          await artifact.$relatedQuery("pages", trx).delete();
          console.log(
            `[Generate Content] Deleted ${existingPages.length} existing pages`
          );
        }

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
            monologue_text: null,
            pet_actor: null,
          },
        });
        console.log(
          `[Generate Content] Reset artifact fields to initial state`
        );
      });

      // Reload artifact after reset
      artifact = await Artifact.query()
        .findById(artifactId)
        .withGraphFetched("[input, actors, app]");
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

    // Handle missing prompts by generating from images (for image-only inputs)
    if (!artifact.input.prompt && artifact.input.metadata?.image_only_input) {
      console.log(
        `[Generate Content] No prompt found, generating from uploaded images...`
      );

      try {
        // Get images associated with the input
        const inputMedia = await Media.query()
          .where("owner_type", "input")
          .where("owner_id", artifact.input.id)
          .where("media_type", "image")
          .where("status", "committed");

        if (inputMedia.length === 0) {
          throw new Error("No images found for image-only input");
        }

        console.log(
          `[Generate Content] Found ${inputMedia.length} images to analyze`
        );

        // Analyze all images and collect descriptions
        const imageDescriptions = [];
        let totalAnalysisCost = 0;

        for (const media of inputMedia) {
          // Check if already analyzed
          const existingAnalysis =
            await imageAnalysisService.getAnalysisResults(media.id);

          if (existingAnalysis) {
            imageDescriptions.push(existingAnalysis.description);
            console.log(
              `[Generate Content] Using existing analysis for ${media.image_key}`
            );
          } else {
            // Analyze the image
            const analysisResult = await imageAnalysisService.analyzeImageMedia(
              media
            );
            imageDescriptions.push(analysisResult.description);
            totalAnalysisCost += analysisResult.cost;
            console.log(
              `[Generate Content] Analyzed ${
                media.image_key
              }, cost: $${analysisResult.cost.toFixed(6)}`
            );
          }
        }

        // Generate appropriate prompt based on app type
        let generatedPrompt;
        switch (appSlugToUse) {
          case "saywut":
            generatedPrompt = await aiService.generateThoughtFromImages(
              imageDescriptions
            );
            break;
          default:
            generatedPrompt = await aiService.generateStoryPromptFromImages(
              imageDescriptions
            );
            break;
        }

        console.log(
          `[Generate Content] Generated prompt: "${generatedPrompt}"`
        );
        console.log(
          `[Generate Content] Total analysis cost: $${totalAnalysisCost.toFixed(
            6
          )}`
        );

        // Update the input with the generated prompt
        await artifact.input.$query().patch({
          prompt: generatedPrompt,
          metadata: {
            ...artifact.input.metadata,
            prompt_generated_from_images: true,
            image_analysis_cost: totalAnalysisCost,
            prompt_generated_at: new Date().toISOString(),
          },
        });

        // Reload the artifact to get the updated input
        artifact = await Artifact.query()
          .findById(artifactId)
          .withGraphFetched("[input, actors, app]");

        console.log(`[Generate Content] Updated input with generated prompt`);
      } catch (error) {
        console.error(
          "[Generate Content] Failed to generate prompt from images:",
          error
        );
        throw new Error(
          `Failed to generate prompt from images: ${error.message}`
        );
      }
    }

    // Route to appropriate service based on app
    let generationResult;
    let updatedArtifact;

    if (appSlugToUse === "saywut") {
      // Generate pet inner monologue for fursona app
      console.log(
        `[Generate Content] Starting AI generation for pet inner monologue...`
      );
      generationResult =
        await fursonaPetVoiceService.generateMonologueFromInput(
          artifact.input,
          artifact.actors
        );

      // Save the monologue to the artifact
      console.log(`[Generate Content] Saving generated monologue...`);
      updatedArtifact = await Artifact.transaction(async (trx) => {
        return await fursonaPetVoiceService.saveMonologueToArtifact(
          artifactId,
          generationResult,
          trx
        );
      });

      console.log(
        `[Generate Content] Successfully generated pet monologue for "${updatedArtifact.title}"`
      );
    } else {
      // Default to snugglebug story generation
      console.log(`[Generate Content] Starting AI generation for story...`);
      generationResult = await snugglebugStoryService.generateStoryFromInput(
        artifact.input,
        artifact.actors
      );

      // Save the story to the artifact within a transaction
      console.log(`[Generate Content] Saving generated story...`);
      updatedArtifact = await Artifact.transaction(async (trx) => {
        return await snugglebugStoryService.saveStoryToArtifact(
          artifactId,
          generationResult,
          trx,
          { skipImageGeneration }
        );
      });

      console.log(
        `[Generate Content] Successfully generated "${
          updatedArtifact.title
        }" with ${updatedArtifact.pages?.length || 0} pages`
      );
    }

    const generationCount = updatedArtifact.metadata?.generation_count || 1;
    const generationType = regenerate ? "regenerated" : "generated";

    console.log(
      `[Generate Content] Content ${generationType} (generation #${generationCount})`
    );
    console.log(
      `[Generate Content] Token usage: ${
        updatedArtifact.total_tokens
      }, Cost: $${parseFloat(updatedArtifact.cost_usd).toFixed(4)}`
    );

    return {
      success: true,
      artifactId: artifact.id,
      title: updatedArtifact.title,
      pages: updatedArtifact.pages?.length || 0,
      tokens: updatedArtifact.total_tokens,
      cost: parseFloat(updatedArtifact.cost_usd),
      regenerate: regenerate,
      generation_count: generationCount,
      app_slug: appSlugToUse,
      content_type: appSlugToUse === "saywut" ? "monologue" : "story",
    };
  } catch (error) {
    console.error(
      `[Generate Content] Error processing job for artifact ${artifactId}:`,
      error
    );

    // Update artifact with error status
    if (artifactId) {
      try {
        const failedArtifact = await Artifact.query().findById(artifactId);
        if (failedArtifact) {
          await failedArtifact.markAsFailed(error);
          console.log(
            `[Generate Content] Updated artifact ${artifactId} status to failed`
          );
        }
      } catch (updateError) {
        console.error(
          `[Generate Content] Failed to update artifact status:`,
          updateError
        );
      }
    }

    throw error;
  }
}
