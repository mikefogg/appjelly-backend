/**
 * Generate Post Job
 * Generates a social media post from a user prompt
 */

import { Account, Artifact, VoiceProfile } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import { trackAICost } from "#src/helpers/track-ai-cost.js";

export const JOB_GENERATE_POST = "generate-post";

export default async function generatePost(job) {
  const { artifactId } = job.data;

  console.log(`[Generate Post] Starting generation for artifact: ${artifactId}`);

  try {
    // Get artifact with input and connected account
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched("[input, connected_account]");

    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    // Load account for tracking (freemium checks done at route level)
    const account = await Account.query()
      .findById(artifact.account_id)
      .withGraphFetched("subscriptions");

    const { input, connected_account } = artifact;

    // Get prompt from input or artifact metadata (for existing posts without input)
    const prompt = input?.prompt || artifact.metadata?.prompt;
    if (!prompt) {
      throw new Error(`No prompt found for artifact ${artifactId}`);
    }

    // Extract angle, length, formatting, and instructions from metadata
    // Prefer artifact.metadata (set by /generate endpoint) over input.metadata
    const angle = artifact.metadata?.angle || input?.metadata?.angle;
    const length = artifact.metadata?.length || input?.metadata?.length;
    const formatting = artifact.metadata?.formatting || input?.metadata?.formatting;
    const instructions = artifact.metadata?.instructions || input?.metadata?.instructions;
    const originalContent = artifact.metadata?.original_content; // Set when using post_id
    const platform = connected_account?.platform || "ghost";

    // Calculate character limit based on platform and length
    const getCharacterLimit = (platform, length) => {
      const limits = {
        twitter: { short: 100, medium: 280, long: 5000 },
        linkedin: { short: 150, medium: 600, long: 2000 },
        threads: { short: 100, medium: 300, long: 500 },
        facebook: { short: 80, medium: 400, long: 2000 },
        ghost: { short: 100, medium: 300, long: 2000 }, // Default fallback
      };

      const platformLimits = limits[platform] || limits.ghost;
      return platformLimits[length] || platformLimits.medium;
    };

    const maxLength = getCharacterLimit(platform, length);

    // Mark as generating
    await artifact.$query().patch({
      status: "generating",
    });

    job.updateProgress(20);

    // Get voice profile for this connected account
    const voiceProfile = await VoiceProfile.getCurrentProfile(connected_account.id);

    console.log(`[Generate Post] Generating from prompt: "${prompt.substring(0, 50)}..."`);
    console.log(`[Generate Post] Angle: ${angle}, Length: ${length}, Max chars: ${maxLength}`);
    if (originalContent) {
      console.log(`[Generate Post] Regenerating existing content (${originalContent.length} chars)`);
    }
    if (voiceProfile) {
      console.log(`[Generate Post] Using voice profile v${voiceProfile.version}`);
    } else {
      console.log(`[Generate Post] No voice profile found`);
    }

    // Build the topic from prompt + optional instructions
    let topic;
    if (originalContent) {
      // Regenerating existing post - use original content as base, apply angle/instructions
      const angleInstruction = angle ? `Rewrite this as a ${angle.replace(/_/g, " ")} style post.` : "Improve and refine this post.";
      topic = `${angleInstruction}${instructions ? ` ${instructions}` : ""}\n\nOriginal post:\n${originalContent}${prompt && prompt !== originalContent ? `\n\nAdditional context: ${prompt}` : ""}`;
    } else if (angle === "clean_up") {
      // For clean_up angle, the prompt is the content to polish
      topic = `Polish and refine this draft into a better post while preserving the core message. Keep a similar length. Here's the draft:\n\n${prompt}`;
    } else if (instructions) {
      // Add user instructions to the topic
      topic = `${prompt}\n\nAdditional instructions: ${instructions}`;
    } else {
      topic = prompt;
    }

    // Generate post using AI service
    const result = await AI.generatePost({
      topic,
      voiceProfile: voiceProfile?.toPromptFormat(),
      bio: connected_account?.bio,
      contentType: angle === "clean_up" ? "post" : (angle || "post"),
      platform: platform,
      maxLength: maxLength,
      formatting,
    });

    // Track AI usage
    if (result.usage) {
      trackAICost(artifact.account_id, {
        operation: "post_generate",
        model: result.usage.model,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        durationMs: result.usage.duration_ms,
        connectedAccountId: connected_account?.id,
        isFreeUser: account ? !account.hasActiveSubscription() : false,
        metadata: {
          platform,
          angle,
          length,
          max_length: maxLength,
          content_length: result.content?.length || 0,
        },
      });
    }

    job.updateProgress(90);

    // Update artifact with generated content
    // For regeneration (has originalContent), we'll create a new version
    // For new generation, we create the initial version
    const isRegeneration = !!originalContent;

    console.log(`[Generate Post] isRegeneration: ${isRegeneration}`);

    if (isRegeneration) {
      // Check if artifact has any versions yet
      const versionCount = await artifact.getVersionCount();
      console.log(`[Generate Post] Existing version count: ${versionCount}`);

      if (versionCount === 0 && artifact.content) {
        // Create v1 from original content before creating new version
        console.log(`[Generate Post] Creating initial version from original content`);
        await artifact.$query().patch({ content: originalContent });
        await artifact.createInitialVersion("generation", {
          prompt: artifact.metadata?.prompt || prompt,
          angle: artifact.metadata?.angle,
          length: artifact.metadata?.length,
        });
      }

      // Update artifact content
      // Accumulate tokens/cost - ensure proper integer/number types
      const newTotalTokens = parseInt(artifact.total_tokens || 0, 10) + parseInt(result.metadata.total_tokens || 0, 10);
      const newPromptTokens = parseInt(artifact.prompt_tokens || 0, 10) + parseInt(result.metadata.prompt_tokens || 0, 10);
      const newCompletionTokens = parseInt(artifact.completion_tokens || 0, 10) + parseInt(result.metadata.completion_tokens || 0, 10);
      const newCostUsd = parseFloat(artifact.cost_usd || 0) + parseFloat(result.metadata.cost_usd || 0);

      await artifact.$query().patch({
        status: "completed",
        content: result.content,
        total_tokens: newTotalTokens,
        prompt_tokens: newPromptTokens,
        completion_tokens: newCompletionTokens,
        cost_usd: newCostUsd,
        generation_time_seconds: result.metadata.generation_time_seconds,
        ai_model: result.metadata.ai_model,
        ai_provider: result.metadata.ai_provider,
        metadata: {
          ...artifact.metadata,
          original_content: undefined, // Clear after use
        },
      });

      // Create new version with the regenerated content
      const updatedArtifact = await Artifact.query().findById(artifact.id);
      const newVersion = await updatedArtifact.createVersion(result.content, "generation", {
        prompt,
        angle,
        length,
        instructions,
      });
      console.log(`[Generate Post] Created new version: v${newVersion.version_number}`);
    } else {
      // New generation - set version to 1
      await artifact.$query().patch({
        status: "completed",
        content: result.content,
        current_version_number: 1,
        total_tokens: result.metadata.total_tokens,
        prompt_tokens: result.metadata.prompt_tokens,
        completion_tokens: result.metadata.completion_tokens,
        cost_usd: result.metadata.cost_usd,
        generation_time_seconds: result.metadata.generation_time_seconds,
        ai_model: result.metadata.ai_model,
        ai_provider: result.metadata.ai_provider,
        metadata: {
          ...artifact.metadata,
        },
      });

      // Create initial version
      const updatedArtifact = await Artifact.query().findById(artifact.id);
      await updatedArtifact.createInitialVersion("generation", {
        prompt,
        angle,
        length,
      });
    }

    job.updateProgress(100);

    console.log(`[Generate Post] Post generated successfully`);
    console.log(`[Generate Post] Content: "${result.content.substring(0, 100)}..."`);
    console.log(`[Generate Post] Tokens: ${result.metadata.total_tokens}, Cost: $${result.metadata.cost_usd}`);

    return {
      success: true,
      artifact_id: artifactId,
      content_length: result.content.length,
      tokens_used: result.metadata.total_tokens,
      cost_usd: result.metadata.cost_usd,
      completed_at: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[Generate Post] Error:`, error);

    // Mark artifact as failed
    try {
      const artifact = await Artifact.query().findById(artifactId);
      if (artifact) {
        await artifact.$query().patch({
          status: "failed",
          metadata: {
            ...artifact.metadata,
            error: error.message,
            failed_at: new Date().toISOString(),
          },
        });
      }
    } catch (updateError) {
      console.error("Failed to update artifact error status:", updateError);
    }

    throw error; // Re-throw to trigger job retry
  }
}
