/**
 * Generate Onboarding Sample Job
 * Generates a sample post using personality stats during the onboarding flow
 */

import { OnboardingSample } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import { buildVoiceFromStats } from "#src/helpers/personality.js";
import { trackAICost } from "#src/helpers/track-ai-cost.js";

export const JOB_GENERATE_ONBOARDING_SAMPLE = "generate-onboarding-sample";

// Same limits as generate-post.js
const getCharacterLimit = (platform, length) => {
  const limits = {
    twitter: { short: 100, medium: 280, long: 5000 },
    linkedin: { short: 150, medium: 600, long: 2000 },
    threads: { short: 100, medium: 300, long: 500 },
    facebook: { short: 80, medium: 400, long: 2000 },
    ghost: { short: 100, medium: 300, long: 2000 },
  };
  const platformLimits = limits[platform] || limits.ghost;
  return platformLimits[length] || platformLimits.medium;
};

// Map brevity stat to length
const brevityToLength = {
  short: "short",
  medium: "medium",
  long: "long",
};

export default async function generateOnboardingSample(job) {
  const { sampleId } = job.data;

  console.log(`[Generate Onboarding Sample] Starting generation for sample: ${sampleId}`);

  try {
    // Get sample
    const sample = await OnboardingSample.query()
      .findById(sampleId)
      .withGraphFetched("previous_sample");

    if (!sample) {
      throw new Error(`Sample ${sampleId} not found`);
    }

    // Mark as generating
    await sample.markGenerating();
    job.updateProgress(10);

    // Build voice profile and formatting from stats
    const { formatting, voiceHints } = buildVoiceFromStats(sample.stats);

    // Apply overrides from metadata (length, line_breaks)
    const overrides = sample.metadata?.overrides || {};
    if (overrides.line_breaks) {
      formatting.line_breaks = overrides.line_breaks;
    }

    // Determine length: use override, or map from brevity stat, or default to medium
    const length = overrides.length || brevityToLength[sample.stats.brevity] || "medium";
    const maxLength = getCharacterLimit(sample.platform, length);

    console.log(`[Generate Onboarding Sample] Stats:`, JSON.stringify(sample.stats));
    console.log(`[Generate Onboarding Sample] Overrides:`, JSON.stringify(overrides));
    console.log(`[Generate Onboarding Sample] Length: ${length}, MaxLength: ${maxLength}`);
    console.log(`[Generate Onboarding Sample] Formatting:`, JSON.stringify(formatting));

    // Build the idea/prompt
    let idea = sample.input;

    // If this is a feedback iteration, include context
    if (sample.previous_sample && sample.feedback_input) {
      idea = `Improve this post based on the feedback.

Previous post:
${sample.previous_sample.content}

Feedback: ${sample.feedback_input}

Original topic: ${sample.input}`;
    } else if (sample.previous_sample) {
      // Regeneration without explicit feedback - try again with same topic
      idea = `Write a different version of a post about: ${sample.input}

Try a different angle or approach than this previous attempt:
${sample.previous_sample.content}`;
    }

    job.updateProgress(30);

    // Generate using AI service
    const generateResult = await AI.generatePosts({
      voiceProfile: voiceHints,
      bio: null, // No bio during onboarding
      platform: sample.platform,
      maxLength,
      formatting,
      userRules: [], // No rules during onboarding
      ideas: [{ idea, content_type: "sample" }],
    });

    job.updateProgress(80);

    // Extract the result
    const content = generateResult.posts[0]?.content || "";

    // Track AI costs (using account_id if available)
    if (generateResult.usages && generateResult.usages.length > 0) {
      for (const usage of generateResult.usages) {
        // Only track if we have an account_id
        if (sample.account_id) {
          trackAICost(sample.account_id, {
            operation: `onboarding_sample_${usage.operation}`,
            model: usage.model,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            durationMs: usage.duration_ms,
            connectedAccountId: null,
            isFreeUser: true, // Onboarding users are treated as free
            metadata: {
              platform: sample.platform,
              sample_id: sample.id,
              version: sample.version,
              content_length: content.length,
            },
          });
        }
      }
    }

    // Complete the sample
    await sample.complete(content, {
      model: generateResult.usage?.model,
      total_tokens: generateResult.usage?.total_tokens || 0,
      duration_ms: generateResult.usage?.duration_ms || 0,
    });

    job.updateProgress(100);

    console.log(`[Generate Onboarding Sample] Sample generated successfully`);
    console.log(`[Generate Onboarding Sample] Content: "${content.substring(0, 100)}..."`);

    return {
      success: true,
      sample_id: sampleId,
      content_length: content.length,
      version: sample.version,
      completed_at: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[Generate Onboarding Sample] Error:`, error);

    // Mark sample as failed
    try {
      const sample = await OnboardingSample.query().findById(sampleId);
      if (sample) {
        await sample.fail(error);
      }
    } catch (updateError) {
      console.error("Failed to update sample error status:", updateError);
    }

    throw error;
  }
}
