/**
 * Generate Post Job
 * Generates a social media post from a user prompt
 */

import { Account, Artifact, VoiceProfile, Rule } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import { trackAICost } from "#src/helpers/track-ai-cost.js";
import { ghostQueue } from "#src/background/queues/index.js";

export const JOB_GENERATE_POST = "generate-post";
const VOICE_UPDATE_RETRY_DELAY_MS = 5000; // 5 seconds

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

    // Check for pending (delayed) voice profile job and promote it to run immediately
    const voiceJobId = `generate-voice-${connected_account.id}`;
    const pendingVoiceJob = await ghostQueue.getJob(voiceJobId);
    if (pendingVoiceJob) {
      const state = await pendingVoiceJob.getState();
      if (state === "delayed") {
        console.log(`[Generate Post] Promoting delayed voice profile job ${voiceJobId}`);
        await pendingVoiceJob.promote();
      }
    }

    // Check if voice profile is being generated - if so, delay this job
    const generatingProfile = await VoiceProfile.getGeneratingProfile(connected_account.id);
    if (generatingProfile) {
      const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000);
      const isStale = new Date(generatingProfile.created_at) < fifteenSecondsAgo;

      if (isStale) {
        console.log(`[Generate Post] Found stale generating profile ${generatingProfile.id} - cleaning up`);
        await generatingProfile.$query().delete();
      } else {
        console.log(`[Generate Post] Voice profile being generated, rescheduling in ${VOICE_UPDATE_RETRY_DELAY_MS}ms`);
        await ghostQueue.add(JOB_GENERATE_POST, job.data, {
          delay: VOICE_UPDATE_RETRY_DELAY_MS,
        });
        return {
          success: true,
          delayed: true,
          reason: "Voice profile update in progress - rescheduled",
        };
      }
    }

    // Get voice profile and user rules for this connected account
    const [voiceProfile, userRules] = await Promise.all([
      VoiceProfile.getCurrentProfile(connected_account.id),
      Rule.getActiveRules(connected_account.id),
    ]);

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
    if (userRules.length > 0) {
      console.log(`[Generate Post] Using ${userRules.length} user rules`);
    }

    // Build the idea from prompt + optional instructions
    let idea;
    let contentType = angle || "post";

    if (originalContent) {
      // Regenerating existing post - use original content as base, apply angle/instructions
      const angleInstruction = angle ? `Rewrite this as a ${angle.replace(/_/g, " ")} style post.` : "Improve and refine this post.";
      idea = `${angleInstruction}${instructions ? ` ${instructions}` : ""}\n\nOriginal post:\n${originalContent}${prompt && prompt !== originalContent ? `\n\nAdditional context: ${prompt}` : ""}`;
      contentType = "regeneration";
    } else if (angle === "clean_up") {
      // For clean_up angle, the prompt is the content to polish
      idea = `Polish and refine this draft into a better post while preserving the core message. Keep a similar length. Here's the draft:\n\n${prompt}`;
      contentType = "improvement";
    } else if (instructions) {
      // Add user instructions to the idea
      idea = `${prompt}\n\nAdditional instructions: ${instructions}`;
    } else {
      idea = prompt;
    }

    // Generate post using AI service with ideas parameter (skips Step 1, uses GPT-4.1)
    const generateResult = await AI.generatePosts({
      voiceProfile: voiceProfile?.toPromptFormat(),
      bio: connected_account?.bio,
      platform,
      maxLength,
      formatting,
      userRules: userRules.map(r => ({ rule_type: r.rule_type, content: r.content })),
      ideas: [{ idea, content_type: contentType }],
    });

    // Extract the single post result
    const result = {
      content: generateResult.posts[0]?.content || "",
      metadata: {
        model: generateResult.usage?.model,
        total_tokens: generateResult.usage?.total_tokens || 0,
        prompt_tokens: generateResult.usage?.input_tokens || 0,
        completion_tokens: generateResult.usage?.output_tokens || 0,
        cost_usd: 0, // Calculate if needed
        generation_time_seconds: (generateResult.usage?.duration_ms || 0) / 1000,
        ai_model: generateResult.usage?.model,
        ai_provider: "openai",
      },
      usages: generateResult.usages,
    };

    // Track each AI call separately for accurate cost tracking
    if (result.usages && result.usages.length > 0) {
      for (const usage of result.usages) {
        trackAICost(artifact.account_id, {
          operation: `post_generate_${usage.operation}`, // e.g. post_generate_post_formatting
          model: usage.model,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          durationMs: usage.duration_ms,
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
