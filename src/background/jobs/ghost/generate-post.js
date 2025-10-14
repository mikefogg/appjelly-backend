/**
 * Generate Post Job
 * Generates a social media post from a user prompt
 */

import { Artifact, ConnectedAccount } from "#src/models/index.js";
import postGenerator from "#src/services/ai/post-generator.js";

export const JOB_GENERATE_POST = "generate-post";

export default async function generatePost(job) {
  const { artifactId } = job.data;

  console.log(`[Generate Post] Starting generation for artifact: ${artifactId}`);

  try {
    // Get artifact with input and connected account
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched("[input, connected_account.writing_style]");

    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    const { input, connected_account } = artifact;

    if (!input) {
      throw new Error(`No input found for artifact ${artifactId}`);
    }

    const prompt = input.prompt;
    if (!prompt) {
      throw new Error(`No prompt found in input`);
    }

    // Mark as generating
    await artifact.$query().patch({
      status: "generating",
    });

    job.updateProgress(20);

    // Get writing style
    const writingStyle = connected_account?.writing_style;

    console.log(`[Generate Post] Generating from prompt: "${prompt.substring(0, 50)}..."`);
    if (writingStyle) {
      console.log(`[Generate Post] Using writing style: ${writingStyle.tone}`);
    }

    // Generate post
    const result = await postGenerator.generatePost(prompt, {
      platform: connected_account?.platform || "twitter",
      writingStyle: writingStyle ? {
        tone: writingStyle.tone,
        avg_length: writingStyle.avg_length,
        emoji_frequency: writingStyle.emoji_frequency,
        hashtag_frequency: writingStyle.hashtag_frequency,
        common_phrases: writingStyle.common_phrases,
        style_summary: writingStyle.style_summary,
      } : null,
      maxLength: 280,
      connectedAccount: connected_account ? {
        username: connected_account.username,
        platform: connected_account.platform,
      } : null,
    });

    job.updateProgress(80);

    // Update artifact with generated content
    await artifact.$query().patch({
      status: "completed",
      content: result.content,
      total_tokens: result.metadata.total_tokens,
      prompt_tokens: result.metadata.prompt_tokens,
      completion_tokens: result.metadata.completion_tokens,
      cost_usd: result.metadata.cost_usd,
      generation_time_seconds: result.metadata.generation_time_seconds,
      ai_model: result.metadata.ai_model,
      ai_provider: result.metadata.ai_provider,
    });

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
