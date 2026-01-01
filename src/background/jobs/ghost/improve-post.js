/**
 * Improve Post Job
 * Improves a social media post using AI (background processing)
 */

import { Account, Artifact, ConnectedAccount, VoiceProfile, Rule } from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import { trackAICost } from "#src/helpers/track-ai-cost.js";
import {
  getLengthBucket,
  getNextBucketUp,
  getNextBucketDown,
  getTargetLength,
} from "#src/config/platform-lengths.js";

export const JOB_IMPROVE_POST = "improve-post";

export default async function improvePost(job) {
  const { artifactId, accountId } = job.data;

  console.log(`[Improve Post Job] Starting improvement for artifact: ${artifactId}`);

  try {
    // Get artifact
    const artifact = await Artifact.query().findById(artifactId);

    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    if (artifact.status !== "pending") {
      console.log(`[Improve Post Job] Artifact ${artifactId} is not in pending status, skipping`);
      return { skipped: true, reason: "not_pending_status" };
    }

    // Load account for tracking
    const account = await Account.query()
      .findById(accountId)
      .withGraphFetched("subscriptions");

    // Get connection if exists
    const connection = artifact.connected_account_id
      ? await ConnectedAccount.query().findById(artifact.connected_account_id)
      : null;

    // Extract improve params from metadata
    const {
      instructions,
      adjust_length,
      length,
      line_breaks,
      emojis,
      hashtags,
      original_content,
    } = artifact.metadata?.improve_params || {};

    const platform = connection?.platform || "ghost";

    // Get content preferences
    const contentPrefs = connection?.getContentPreferences() || {};

    let targetLength = null;
    let targetBucket = null;

    if (length) {
      // Absolute length specified
      targetBucket = length;
      targetLength = getTargetLength(platform, length);
    } else if (adjust_length) {
      // Relative adjustment
      const currentBucket = getLengthBucket(platform, original_content.length);
      targetBucket = adjust_length === "expand"
        ? getNextBucketUp(currentBucket)
        : getNextBucketDown(currentBucket);

      if (targetBucket) {
        targetLength = getTargetLength(platform, targetBucket);
      }
    } else {
      // No explicit length - preserve current content length by default
      const storedLength = artifact.metadata?.length;
      const currentBucket = getLengthBucket(platform, original_content.length);
      targetBucket = storedLength || currentBucket || contentPrefs.default_length;
      targetLength = original_content.length;

      // Detect length intent from instructions
      if (instructions) {
        const lowerInstructions = instructions.toLowerCase();

        const doublingKeywords = /\b(translat(e|ion)|add.*(version|translation))\b/;
        const expansionKeywords = /\b(add|append|expand|longer|extend|elaborate|include|more detail|more context)\b/;
        const contractionKeywords = /\b(shorter|shrink|condense|shorten|reduce|trim|cut|concise|brief|summarize|compact)\b/;

        if (doublingKeywords.test(lowerInstructions)) {
          targetLength = Math.round(original_content.length * 1.5);
          targetBucket = getLengthBucket(platform, targetLength) || "long";
        } else if (expansionKeywords.test(lowerInstructions)) {
          const nextUp = getNextBucketUp(targetBucket);
          if (nextUp) {
            targetBucket = nextUp;
            targetLength = getTargetLength(platform, targetBucket);
          }
        } else if (contractionKeywords.test(lowerInstructions)) {
          const nextDown = getNextBucketDown(targetBucket);
          if (nextDown) {
            targetBucket = nextDown;
            targetLength = getTargetLength(platform, targetBucket);
          }
        }
      }
    }

    console.log(`[Improve Post Job] Length config:`, {
      currentLength: original_content.length,
      targetBucket,
      targetLength,
    });

    // Build length instruction for AI
    let lengthInstruction = "";
    if (targetLength && targetBucket) {
      if (targetBucket === "long" && platform === "twitter") {
        lengthInstruction = `\n\nTARGET LENGTH: Expand to approximately ${targetLength} characters. Keep a compelling hook in the first 280 characters to encourage readers to click "Show more".`;
      } else if (targetBucket === "long" && platform === "linkedin") {
        lengthInstruction = `\n\nTARGET LENGTH: Expand to approximately ${targetLength} characters. Keep the first 150 characters as a strong hook before the "See more" cutoff.`;
      } else if (original_content.length > targetLength) {
        lengthInstruction = `\n\nTARGET LENGTH: Condense to approximately ${targetLength} characters while preserving the core message.`;
      } else {
        lengthInstruction = `\n\nTARGET LENGTH: Expand to approximately ${targetLength} characters with more detail and depth.`;
      }
    }

    // Build idea for improvement
    let improvementIdea;
    if (instructions || lengthInstruction) {
      improvementIdea = `Improve this post${instructions ? ` with the following instructions: "${instructions}"` : ""}.${lengthInstruction}${!lengthInstruction ? "\n\nIMPORTANT: Keep the same approximate length unless otherwise specified." : ""}

Original post:
${original_content}`;
    } else {
      improvementIdea = `Improve this post while keeping the core message, tone, and similar length:

${original_content}`;
    }

    // Get voice profile and user rules
    const [voiceProfile, userRules] = connection
      ? await Promise.all([
          VoiceProfile.getCurrentProfile(connection.id),
          Rule.getActiveRules(connection.id),
        ])
      : [null, []];

    // Determine formatting preferences
    const postFormatting = artifact.metadata?.formatting || {};
    const formattingOverrides = {
      line_breaks: line_breaks || postFormatting.line_breaks || contentPrefs.line_breaks,
      emojis: emojis || postFormatting.emojis || contentPrefs.emojis,
      hashtags: hashtags || postFormatting.hashtags || contentPrefs.hashtags,
    };

    // Get AI improvement
    const fallbackLength = getTargetLength(platform, "short");
    const generateResult = await AI.generatePosts({
      voiceProfile: voiceProfile?.toPromptFormat(),
      bio: connection?.bio,
      platform,
      maxLength: targetLength || fallbackLength,
      formatting: formattingOverrides,
      userRules: userRules.map(r => ({ rule_type: r.rule_type, content: r.content })),
      ideas: [{ idea: improvementIdea, content_type: "improvement" }],
    });

    // Track AI cost
    if (generateResult.usages && generateResult.usages.length > 0) {
      for (const usage of generateResult.usages) {
        trackAICost(accountId, {
          operation: `post_improve_${usage.operation}`,
          model: usage.model,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          durationMs: usage.duration_ms,
          connectedAccountId: connection?.id,
          isFreeUser: !account.hasActiveSubscription(),
          metadata: {
            platform,
            artifact_id: artifact.id,
            target_length: targetBucket,
            content_length: generateResult.posts[0]?.content?.length || 0,
          },
        });
      }
    }

    const improvedContent = generateResult.posts[0]?.content || "";

    // Dev: print before/after
    if (process.env.NODE_ENV === "development") {
      console.log(`[Improve Post Job] Before/After comparison:`);
      console.log(`--- ORIGINAL (${original_content.length} chars) ---`);
      console.log(original_content);
      console.log(`--- IMPROVED (${improvedContent.length} chars) ---`);
      console.log(improvedContent);
      console.log(`--- END ---`);
    }

    // Create new version with improved content
    const newVersion = await artifact.createVersion(improvedContent, "improvement", {
      instructions: instructions || null,
      adjust_length: adjust_length || null,
      target_length: targetBucket || null,
      formatting: formattingOverrides,
    });

    // Update artifact status and content
    await artifact.$query().patch({
      content: improvedContent,
      status: "draft",
      metadata: {
        ...artifact.metadata,
        improve_params: undefined, // Clear the improve params
      },
    });

    // Increment generated posts counter for free users
    if (connection && !account.hasActiveSubscription()) {
      await connection.incrementGeneratedPosts(1);
    }

    console.log(`[Improve Post Job] Completed - created version ${newVersion.version_number}`);

    return {
      success: true,
      artifactId,
      versionNumber: newVersion.version_number,
      originalLength: original_content.length,
      improvedLength: improvedContent.length,
    };
  } catch (error) {
    console.error(`[Improve Post Job] Error:`, error);

    // Mark artifact as failed
    try {
      await Artifact.query().findById(artifactId).patch({
        status: "failed",
        metadata: {
          error: error.message,
        },
      });
    } catch (patchError) {
      console.error(`[Improve Post Job] Failed to update artifact status:`, patchError);
    }

    throw error;
  }
}
