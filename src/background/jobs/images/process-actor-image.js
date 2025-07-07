import { Actor } from "#src/models/index.js";
import imageGenerationService from "#src/helpers/snugglebug/image-generation-service.js";

export default async function processActorImageJob(job) {
  const { actorId, imageKey } = job.data;

  try {
    console.log(`[Process Actor Image] Starting image processing for actor ${actorId}, image ${imageKey}`);

    // Get the actor
    let actor = await Actor.query().findById(actorId);
    if (!actor) {
      throw new Error(`Actor ${actorId} not found`);
    }

    // Update status to analyzing
    await actor.$query().patch({
      image_status: 'analyzing'
    });

    console.log(`[Process Actor Image] Analyzing character image for ${actor.name}...`);

    // Step 1: Analyze the image to create continuity data
    const analysisResult = await imageGenerationService.analyzeCharacterImage(imageKey, actor);
    
    console.log(`[Process Actor Image] Analysis complete. Tokens: ${analysisResult.analysis_tokens}, Cost: $${analysisResult.analysis_cost.toFixed(4)}`);

    // Update actor with analysis results
    await actor.$query().patch({
      character_continuity: analysisResult.continuity,
      analysis_tokens: analysisResult.analysis_tokens,
      analysis_cost_usd: analysisResult.analysis_cost,
      image_status: 'generating_avatar'
    });

    console.log(`[Process Actor Image] Generating avatar for ${actor.name}...`);

    // Step 2: Generate avatar from continuity data
    const avatarResult = await imageGenerationService.generateAvatarImage(
      analysisResult.continuity, 
      actor
    );

    console.log(`[Process Actor Image] Avatar generated: ${avatarResult.image_key}, Cost: $${avatarResult.generation_cost.toFixed(4)}`);

    // Update actor with final results
    await actor.$query().patch({
      avatar_image_key: avatarResult.image_key,
      avatar_generation_cost_usd: avatarResult.generation_cost,
      image_status: 'completed',
      image_processed_at: new Date().toISOString(),
      metadata: {
        ...actor.metadata,
        image_processing: {
          analysis_model: 'gpt-4o',
          generation_model: 'gpt-image',
          ai_provider: 'openai',
          processed_at: new Date().toISOString(),
          total_cost_usd: analysisResult.analysis_cost + avatarResult.generation_cost
        }
      }
    });

    const totalCost = analysisResult.analysis_cost + avatarResult.generation_cost;

    console.log(`[Process Actor Image] Successfully processed ${actor.name}: avatar ${avatarResult.image_key}, total cost $${totalCost.toFixed(4)}`);

    return {
      success: true,
      actorId: actor.id,
      actor_name: actor.name,
      avatar_image_key: avatarResult.image_key,
      analysis_tokens: analysisResult.analysis_tokens,
      total_cost: totalCost
    };

  } catch (error) {
    console.error(`[Process Actor Image] Error processing actor ${actorId}:`, error);

    // Update actor with error status
    if (actorId) {
      try {
        await Actor.query()
          .findById(actorId)
          .patch({
            image_status: 'failed',
            metadata: {
              error: error.message,
              failed_at: new Date().toISOString()
            }
          });
        console.log(`[Process Actor Image] Updated actor ${actorId} status to failed`);
      } catch (updateError) {
        console.error(`[Process Actor Image] Failed to update actor status:`, updateError);
      }
    }

    throw error;
  }
}