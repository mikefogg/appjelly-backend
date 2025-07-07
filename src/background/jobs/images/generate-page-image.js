import { ArtifactPage, Actor } from "#src/models/index.js";
import imageGenerationService from "#src/helpers/snugglebug/image-generation-service.js";

export default async function generatePageImageJob(job) {
  const { pageId, artifactId } = job.data;

  try {
    console.log(`[Generate Page Image] Starting image generation for page ${pageId}`);

    // Get the page with related artifact and actors
    let page = await ArtifactPage.query()
      .findById(pageId)
      .withGraphFetched('[artifact.actors]');
      
    if (!page) {
      throw new Error(`Page ${pageId} not found`);
    }

    if (!page.image_prompt) {
      throw new Error(`Page ${pageId} has no image prompt`);
    }

    console.log(`[Generate Page Image] Found page ${page.page_number} with prompt: "${page.image_prompt?.substring(0, 100)}..."`);

    // Update status to generating
    await page.$query().patch({
      image_status: 'generating'
    });

    // Get character continuity data for actors in this story
    const characters = [];
    if (page.artifact?.actors) {
      for (const actor of page.artifact.actors) {
        if (actor.character_continuity) {
          characters.push({
            name: actor.name,
            type: actor.type,
            continuity: actor.character_continuity
          });
        }
      }
    }

    console.log(`[Generate Page Image] Using continuity data for ${characters.length} characters`);

    // Generate the page image
    const imageResult = await imageGenerationService.generatePageImage(
      page.image_prompt,
      characters
    );

    console.log(`[Generate Page Image] Image generated: ${imageResult.image_key}, Cost: $${imageResult.generation_cost.toFixed(4)}`);

    // Update page with generated image
    console.log(`[Generate Page Image] Updating page ${pageId} with image key: ${imageResult.image_key}`);
    
    const updatedPage = await page.$query().patchAndFetch({
      image_key: imageResult.image_key,
      image_status: 'completed',
      
      // Dedicated tracking fields
      image_generation_cost_usd: imageResult.generation_cost,
      image_generation_time_seconds: imageResult.generation_time || 0,
      image_ai_model: imageResult.model,
      image_ai_provider: 'openai',
      image_generated_at: new Date().toISOString(),
      image_prompt_used: imageResult.prompt_used,
    });
    
    console.log(`[Generate Page Image] Page updated successfully. New image_key: ${updatedPage.image_key}, status: ${updatedPage.image_status}`);

    console.log(`[Generate Page Image] Successfully generated image for page ${page.page_number}: ${imageResult.image_key}`);

    return {
      success: true,
      pageId: page.id,
      page_number: page.page_number,
      image_key: imageResult.image_key,
      generation_cost: imageResult.generation_cost,
      characters_used: characters.length
    };

  } catch (error) {
    console.error(`[Generate Page Image] Error generating image for page ${pageId}:`, error);

    // Update page with error status
    if (pageId) {
      try {
        await ArtifactPage.query()
          .findById(pageId)
          .patch({
            image_status: 'failed',
            // Don't overwrite layout_data - just update status
          });
        console.log(`[Generate Page Image] Updated page ${pageId} status to failed`);
      } catch (updateError) {
        console.error(`[Generate Page Image] Failed to update page status:`, updateError);
      }
    }

    throw error;
  }
}