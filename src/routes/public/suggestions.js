import express from "express";
import { param, query, body } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors } from "#src/middleware/index.js";
import { PostSuggestion, ConnectedAccount, Input, Artifact, NetworkPost, TrendingTopic } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import { successResponse } from "#src/serializers/index.js";
import { ghostQueue, JOB_GENERATE_SUGGESTIONS, JOB_GENERATE_POST } from "#src/background/queues/index.js";
import ContentGenerationService from "#src/services/ContentGenerationService.js";
import { getPlatformSystemPrompt } from "#src/config/platform-rules.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const router = express.Router({ mergeParams: true });

const suggestionParamValidators = [
  param("id").isUUID().withMessage("Invalid suggestion ID"),
];

// GET /suggestions - Get active suggestions for a connected account
router.get(
  "/",
  requireAppContext,
  requireAuth,
  [
    query("connected_account_id")
      .isUUID()
      .withMessage("connected_account_id is required"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { connected_account_id } = req.query;

      // Verify connected account belongs to user
      const connection = await ConnectedAccount.query()
        .findById(connected_account_id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connected account not found", 404));
      }

      // Get all suggestions except dismissed ones
      // Show both pending and used suggestions (used = already copied, still useful to see)
      // Hide dismissed suggestions (dismissed_at is set, no value in showing)
      const suggestions = await PostSuggestion.query()
        .where("connected_account_id", connected_account_id)
        .whereNull("dismissed_at")
        .withGraphFetched("[source_post.network_profile]")
        .orderBy("created_at", "desc");

      const data = suggestions.map(suggestion => ({
        id: suggestion.id,
        suggestion_type: suggestion.suggestion_type,
        content: suggestion.content,
        reasoning: suggestion.reasoning,
        character_count: suggestion.character_count,
        topics: suggestion.topics,
        angle: suggestion.angle,
        length: suggestion.length,
        status: suggestion.status,
        source_post: suggestion.source_post ? {
          id: suggestion.source_post.id,
          content: suggestion.source_post.content,
          posted_at: suggestion.source_post.posted_at,
          engagement_score: suggestion.source_post.engagement_score,
          author: {
            username: suggestion.source_post.network_profile?.username,
            display_name: suggestion.source_post.network_profile?.display_name,
          },
        } : null,
        created_at: suggestion.created_at,
        expires_at: suggestion.expires_at,
      }));

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get suggestions error:", error);
      return res.status(500).json(formatError("Failed to retrieve suggestions"));
    }
  }
);

// GET /suggestions/:id - Get specific suggestion
router.get(
  "/:id",
  requireAppContext,
  requireAuth,
  suggestionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const suggestion = await PostSuggestion.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[source_post.network_profile, connected_account]");

      if (!suggestion) {
        return res.status(404).json(formatError("Suggestion not found", 404));
      }

      // Fetch inspiring network posts if they exist in metadata
      let inspiringPosts = [];
      if (suggestion.metadata?.inspired_by_network_post_ids && Array.isArray(suggestion.metadata.inspired_by_network_post_ids)) {
        const postIds = suggestion.metadata.inspired_by_network_post_ids;
        if (postIds.length > 0) {
          const networkPosts = await NetworkPost.query()
            .whereIn("id", postIds)
            .withGraphFetched("network_profile")
            .orderBy("engagement_score", "desc");

          inspiringPosts = networkPosts.map(post => ({
            id: post.id,
            content: post.content,
            posted_at: post.posted_at,
            engagement_score: post.engagement_score,
            like_count: post.like_count,
            retweet_count: post.retweet_count,
            reply_count: post.reply_count,
            topics: post.topics,
            author: {
              username: post.network_profile?.username,
              display_name: post.network_profile?.display_name,
              profile_image_url: post.network_profile?.profile_image_url,
            },
          }));
        }
      }

      const data = {
        id: suggestion.id,
        suggestion_type: suggestion.suggestion_type,
        content: suggestion.content,
        reasoning: suggestion.reasoning,
        character_count: suggestion.character_count,
        topics: suggestion.topics,
        angle: suggestion.angle,
        length: suggestion.length,
        status: suggestion.status,
        source_post: suggestion.source_post ? {
          id: suggestion.source_post.id,
          content: suggestion.source_post.content,
          posted_at: suggestion.source_post.posted_at,
          engagement_score: suggestion.source_post.engagement_score,
          author: {
            username: suggestion.source_post.network_profile?.username,
            display_name: suggestion.source_post.network_profile?.display_name,
            profile_image_url: suggestion.source_post.network_profile?.profile_image_url,
          },
        } : null,
        inspiring_posts: inspiringPosts,
        metadata: {
          generation_type: suggestion.metadata?.generation_type,
          trending_topics_count: suggestion.metadata?.trending_topics_count,
          trending_posts_count: suggestion.metadata?.trending_posts_count,
        },
        connected_account: {
          id: suggestion.connected_account.id,
          platform: suggestion.connected_account.platform,
          username: suggestion.connected_account.username,
        },
        created_at: suggestion.created_at,
        expires_at: suggestion.expires_at,
      };

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get suggestion error:", error);
      return res.status(500).json(formatError("Failed to retrieve suggestion"));
    }
  }
);

// POST /suggestions/:id/use - Mark suggestion as used and update rotation
router.post(
  "/:id/use",
  requireAppContext,
  requireAuth,
  suggestionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const suggestion = await PostSuggestion.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("connected_account");

      if (!suggestion) {
        return res.status(404).json(formatError("Suggestion not found", 404));
      }

      // Allow marking as used multiple times (user can copy the same suggestion repeatedly)
      // Make it idempotent - if already used, just return success
      if (suggestion.status !== "used") {
        await suggestion.markAsUsed();
      }

      // Update rotation state if suggestion has content_type
      let nextRecommended = null;
      if (suggestion.content_type && suggestion.connected_account) {
        await suggestion.connected_account.updateRotationState(suggestion.content_type);
        nextRecommended = await suggestion.connected_account.getNextRecommendedContentType();
      }

      return res.status(200).json(successResponse({
        message: "Suggestion marked as used",
        status: "used",
        updated_rotation: nextRecommended ? {
          last_content_type: suggestion.content_type,
          last_posted_at: new Date(),
          next_recommended: nextRecommended,
        } : null,
      }));
    } catch (error) {
      console.error("Use suggestion error:", error);
      return res.status(500).json(formatError("Failed to mark suggestion as used"));
    }
  }
);

// POST /suggestions/:id/dismiss - Mark suggestion as dismissed
router.post(
  "/:id/dismiss",
  requireAppContext,
  requireAuth,
  suggestionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const suggestion = await PostSuggestion.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!suggestion) {
        return res.status(404).json(formatError("Suggestion not found", 404));
      }

      // Allow dismissing multiple times - make it idempotent
      // If already dismissed (dismissed_at is set), just return success
      if (!suggestion.dismissed_at) {
        await suggestion.markAsDismissed();
      }

      return res.status(200).json(successResponse({
        message: "Suggestion dismissed",
        dismissed_at: suggestion.dismissed_at || new Date().toISOString(),
      }));
    } catch (error) {
      console.error("Dismiss suggestion error:", error);
      return res.status(500).json(formatError("Failed to dismiss suggestion"));
    }
  }
);

// POST /suggestions/:id/generate-response - Generate a reply to the source post
router.post(
  "/:id/generate-response",
  requireAppContext,
  requireAuth,
  [
    ...suggestionParamValidators,
    body("angle")
      .optional()
      .isString()
      .isIn(["hot_take", "roast", "hype", "story", "teach", "question"])
      .withMessage("Angle must be one of: hot_take, roast, hype, story, teach, question"),
    body("length")
      .optional()
      .isString()
      .isIn(["short", "medium", "long"])
      .withMessage("Length must be one of: short, medium, long"),
    body("additional_instructions")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage("Additional instructions must be between 1 and 200 characters"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { angle, length, additional_instructions } = req.body;

      // Fetch suggestion with source post
      const suggestion = await PostSuggestion.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[source_post.network_profile, connected_account]");

      if (!suggestion) {
        return res.status(404).json(formatError("Suggestion not found", 404));
      }

      if (!suggestion.source_post) {
        return res.status(400).json(formatError("This suggestion has no source post to reply to", 400));
      }

      // Build prompt for generating response
      const sourceAuthor = suggestion.source_post.network_profile?.username || "someone";
      const sourceContent = suggestion.source_post.content;

      let prompt = `Generate a reply to this post from @${sourceAuthor}: "${sourceContent}"`;

      if (additional_instructions) {
        prompt += `\n\nAdditional instructions: ${additional_instructions}`;
      }

      // Create input record
      const input = await Input.query().insert({
        account_id: res.locals.account.id,
        app_id: res.locals.app.id,
        connected_account_id: suggestion.connected_account_id,
        prompt,
        metadata: {
          platform: suggestion.connected_account.platform,
          angle: angle || "question",
          length: length || "medium",
          reply_to: {
            post_id: suggestion.source_post.id,
            author: sourceAuthor,
            content: sourceContent,
          },
        },
      });

      // Create artifact (pending generation)
      const artifact = await Artifact.query().insert({
        input_id: input.id,
        account_id: res.locals.account.id,
        app_id: res.locals.app.id,
        connected_account_id: suggestion.connected_account_id,
        artifact_type: "social_post",
        status: "pending",
        metadata: {
          platform: suggestion.connected_account.platform,
          prompt,
          angle: angle || "question",
          length: length || "medium",
          is_reply: true,
          reply_to_post_id: suggestion.source_post.id,
        },
      });

      // Trigger background job for AI generation
      await ghostQueue.add(JOB_GENERATE_POST, {
        artifactId: artifact.id,
      });

      // Return pending response
      const data = {
        id: artifact.id,
        status: "pending",
        message: "Response generation queued",
        input: {
          id: input.id,
          prompt: input.prompt,
        },
        reply_to: {
          post_id: suggestion.source_post.id,
          author: sourceAuthor,
          content: sourceContent,
        },
      };

      return res.status(202).json(successResponse(data));
    } catch (error) {
      console.error("Generate response error:", error);
      return res.status(500).json(formatError("Failed to generate response"));
    }
  }
);

// POST /suggestions/:id/regenerate - Generate a new variation of the suggestion
router.post(
  "/:id/regenerate",
  requireAppContext,
  requireAuth,
  suggestionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const originalSuggestion = await PostSuggestion.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[connected_account.writing_style]");

      if (!originalSuggestion) {
        return res.status(404).json(formatError("Suggestion not found", 404));
      }

      // TODO: Implement AI regeneration
      // For now, return a placeholder response

      return res.status(501).json(formatError("Regeneration not yet implemented", 501));
    } catch (error) {
      console.error("Regenerate suggestion error:", error);
      return res.status(500).json(formatError("Failed to regenerate suggestion"));
    }
  }
);

// GET /reply-opportunities - Get top engaging posts from network for potential replies
router.get(
  "/reply-opportunities",
  requireAppContext,
  requireAuth,
  [
    query("connected_account_id")
      .isUUID()
      .withMessage("connected_account_id is required"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 20 })
      .withMessage("Limit must be between 1 and 20"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { connected_account_id, limit = 10 } = req.query;

      // Verify connected account belongs to user
      const connection = await ConnectedAccount.query()
        .findById(connected_account_id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connected account not found", 404));
      }

      // Ghost platform doesn't have network posts
      if (connection.platform === "ghost") {
        return res.status(400).json(formatError("Reply opportunities are not available for ghost accounts", 400));
      }

      // Get top engaging posts from the last 48 hours
      const replyOpportunities = await NetworkPost.query()
        .where("connected_account_id", connection.id)
        .where("posted_at", ">", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
        .whereNotNull("engagement_score")
        .withGraphFetched("network_profile")
        .orderBy("engagement_score", "desc")
        .limit(parseInt(limit));

      const data = replyOpportunities.map(post => ({
        id: post.id,
        content: post.content,
        posted_at: post.posted_at,
        engagement_score: post.engagement_score,
        like_count: post.like_count,
        retweet_count: post.retweet_count,
        reply_count: post.reply_count,
        author: {
          username: post.network_profile?.username,
          display_name: post.network_profile?.display_name,
          profile_image_url: post.network_profile?.profile_image_url,
        },
      }));

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get reply opportunities error:", error);
      return res.status(500).json(formatError("Failed to retrieve reply opportunities"));
    }
  }
);

// POST /suggestions/generate - Manually trigger suggestion generation (rate-limited: once per 10 minutes)
router.post(
  "/generate",
  requireAppContext,
  requireAuth,
  [
    body("connected_account_id")
      .isUUID()
      .withMessage("connected_account_id is required"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { connected_account_id } = req.body;

      // Verify connected account belongs to user
      const connection = await ConnectedAccount.query()
        .findById(connected_account_id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connected account not found", 404));
      }

      // No strict requirements - users can generate suggestions with any combination of:
      // - Topics of interest
      // - Sample posts
      // - Voice/rules
      // - Network data (if synced for Twitter)
      // The AI will work with whatever data is available

      // Trigger background job
      const generationStartedAt = new Date().toISOString();

      await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, {
        connectedAccountId: connection.id,
        suggestionCount: 3,
        automated: true, // Set to true for testing push notifications
      });

      return res.status(202).json(successResponse({
        message: "Suggestion generation queued",
        generation_started_at: generationStartedAt,
        polling_instructions: {
          poll_endpoint: `/suggestions?connected_account_id=${connection.id}`,
          check_for_suggestions_created_after: generationStartedAt,
          estimated_completion_seconds: 15,
          recommended_poll_interval_ms: 2000,
        },
      }));
    } catch (error) {
      console.error("Generate suggestions error:", error);
      return res.status(500).json(formatError("Failed to trigger suggestion generation"));
    }
  }
);

// POST /suggestions/from-topic - Generate suggestion from trending topic
router.post(
  "/from-topic",
  requireAppContext,
  requireAuth,
  [
    body("trending_topic_id")
      .isUUID()
      .withMessage("trending_topic_id is required and must be a valid UUID"),
    body("connected_account_id")
      .isUUID()
      .withMessage("connected_account_id is required and must be a valid UUID"),
    body("content_type")
      .optional()
      .isString()
      .isIn(["story", "lesson", "question", "proof", "opinion", "personal", "vision", "cta"])
      .withMessage("content_type must be one of: story, lesson, question, proof, opinion, personal, vision, cta"),
    body("angle")
      .optional()
      .isString()
      .isIn(["agree", "disagree", "hot_take", "question", "personal_story", "explain", "prediction", "lesson"])
      .withMessage("angle must be one of: agree, disagree, hot_take, question, personal_story, explain, prediction, lesson"),
    body("custom_prompt")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage("custom_prompt must be between 1 and 500 characters"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { trending_topic_id, connected_account_id, content_type, angle, custom_prompt } = req.body;

      // Verify connected account belongs to user
      const connection = await ConnectedAccount.query()
        .findById(connected_account_id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connected account not found", 404));
      }

      // Fetch trending topic with curated topic details
      const trendingTopic = await TrendingTopic.query()
        .findById(trending_topic_id)
        .withGraphFetched("curated_topic");

      if (!trendingTopic) {
        return res.status(404).json(formatError("Trending topic not found", 404));
      }

      // Build prompt with rotation context
      const { prompt, contentType: selectedContentType, rotationPosition } =
        ContentGenerationService.buildPromptWithRotation({
          connectedAccount: connection,
          trendingTopic,
          contentType: content_type,
          promptAngle: angle,
          userPrompt: custom_prompt,
        });

      console.log(`[Suggestions from Topic] Generating for trending topic: ${trendingTopic.topic_name}`);

      // Generate with AI using platform-specific system prompt
      const systemPrompt = getPlatformSystemPrompt(connection.platform);

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const generatedContent = response.choices[0].message.content;

      // Create suggestion
      const suggestion = await PostSuggestion.query().insert({
        account_id: res.locals.account.id,
        connected_account_id,
        app_id: res.locals.app.id,
        suggestion_type: "original_post",
        content: generatedContent,
        content_type: selectedContentType,
        source_trending_topic_id: trending_topic_id,
        reasoning: `Generated from trending topic: ${trendingTopic.topic_name}`,
        status: "pending",
        character_count: generatedContent.length,
        angle: null, // Angle stored in metadata.prompt_angle instead
        metadata: {
          generation_source: "trending_topic",
          trending_topic_id: trending_topic_id,
          curated_topic_slug: trendingTopic.curated_topic.slug,
          content_type: selectedContentType,
          rotation_position: rotationPosition,
          prompt_angle: angle,
        },
      });

      // Get next recommended content type for response
      const nextType = await connection.getNextRecommendedContentType();

      const data = {
        suggestion: {
          id: suggestion.id,
          content: suggestion.content,
          content_type: suggestion.content_type,
          angle: suggestion.angle,
          character_count: suggestion.character_count,
          status: suggestion.status,
          created_at: suggestion.created_at,
        },
        source_topic: {
          id: trendingTopic.id,
          topic_name: trendingTopic.topic_name,
          context: trendingTopic.context,
          curated_topic_slug: trendingTopic.curated_topic.slug,
        },
        next_recommended: nextType,
      };

      return res.status(201).json(successResponse(data));
    } catch (error) {
      console.error("Generate from trending topic error:", error);
      return res.status(500).json(formatError("Failed to generate suggestion from trending topic"));
    }
  }
);

export default router;
