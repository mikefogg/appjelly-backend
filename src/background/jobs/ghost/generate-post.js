/**
 * Generate Post Job
 * Generates a social media post from a user prompt
 */

import { Artifact, ConnectedAccount, Rule } from "#src/models/index.js";
import postGenerator from "#src/services/ai/post-generator.js";

export const JOB_GENERATE_POST = "generate-post";

export default async function generatePost(job) {
  const { artifactId } = job.data;

  console.log(`[Generate Post] Starting generation for artifact: ${artifactId}`);

  try {
    // Get artifact with input, connected account, and sample posts
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched("[input, connected_account.[writing_style, sample_posts]]");

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

    // Extract angle and length from metadata
    const angle = input.metadata?.angle || artifact.metadata?.angle;
    const length = input.metadata?.length || artifact.metadata?.length;
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

    // Get writing style, voice, sample posts, and rules
    const writingStyle = connected_account?.writing_style;
    const voice = connected_account?.voice;
    const samplePosts = connected_account?.sample_posts || [];
    const rules = await Rule.getActiveRules(connected_account.id);

    console.log(`[Generate Post] Generating from prompt: "${prompt.substring(0, 50)}..."`);
    console.log(`[Generate Post] Angle: ${angle}, Length: ${length}, Max chars: ${maxLength}`);
    if (voice) {
      console.log(`[Generate Post] Using custom voice`);
    }
    if (samplePosts.length > 0) {
      console.log(`[Generate Post] Using ${samplePosts.length} sample posts`);
    }
    if (writingStyle) {
      console.log(`[Generate Post] Using writing style: ${writingStyle.tone}`);
    }
    if (rules.length > 0) {
      console.log(`[Generate Post] Using ${rules.length} rules`);
    }

    // Generate post
    const result = await postGenerator.generatePost(prompt, {
      platform: platform,
      angle: angle,
      length: length,
      maxLength: maxLength,
      voice: voice,
      samplePosts: samplePosts.map(sp => ({
        content: sp.content,
        notes: sp.notes,
      })),
      rules: rules.map(r => ({
        rule_type: r.rule_type,
        content: r.content,
        priority: r.priority,
      })),
      writingStyle: writingStyle ? {
        tone: writingStyle.tone,
        avg_length: writingStyle.avg_length,
        emoji_frequency: writingStyle.emoji_frequency,
        hashtag_frequency: writingStyle.hashtag_frequency,
        common_phrases: writingStyle.common_phrases,
        style_summary: writingStyle.style_summary,
      } : null,
      connectedAccount: connected_account ? {
        username: connected_account.username,
        platform: connected_account.platform,
      } : null,
    });

    job.updateProgress(80);

    // Extract topics from the generated content
    let topics = [];
    try {
      console.log(`[Generate Post] Extracting topics from generated content...`);
      const OpenAI = await import("openai");
      const openai = new OpenAI.default({
        apiKey: process.env.OPENAI_API_KEY,
      });

      const topicsResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You extract 1-3 main topics or themes from social media posts. Return as JSON object with 'topics' array."
          },
          {
            role: "user",
            content: `Extract 1-3 main topics from this post:\n\n"${result.content}"\n\nReturn JSON like: {"topics": ["topic1", "topic2"]}`
          }
        ],
        temperature: 0.3,
        max_tokens: 100,
        response_format: { type: "json_object" },
      });

      const topicsData = JSON.parse(topicsResponse.choices[0].message.content);
      topics = topicsData.topics || [];
      console.log(`[Generate Post] Extracted topics:`, topics);
    } catch (error) {
      console.warn(`[Generate Post] Failed to extract topics:`, error.message);
    }

    job.updateProgress(90);

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
      metadata: {
        ...artifact.metadata,
        topics,
      },
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
