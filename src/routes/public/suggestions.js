import express from "express";
import { param, query, body } from "express-validator";
import { requireAuth, requireAppContext, requireSubscription, handleValidationErrors } from "#src/middleware/index.js";
import { PostSuggestion, ConnectedAccount, Input, Artifact, NetworkPost, TrendingTopic, VoiceProfile } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import {
  successResponse,
  paginatedResponse,
  suggestionListSerializer,
  suggestionDetailSerializer,
  suggestionUseSerializer,
  suggestionDismissSerializer,
  generateResponsePendingSerializer,
  replyOpportunitySerializer,
  generateSuggestionsQueuedSerializer,
  suggestionFromTopicSerializer,
  inspiringPostSerializer,
} from "#src/serializers/index.js";
import { ghostQueue, JOB_GENERATE_SUGGESTIONS, JOB_GENERATE_POST } from "#src/background/queues/index.js";
import ContentGenerationService from "#src/services/ContentGenerationService.js";
import AI from "#src/services/ai/index.js";

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
    query("batch_id")
      .optional()
      .isUUID()
      .withMessage("batch_id must be a valid UUID"),
    query("latest")
      .optional()
      .isBoolean()
      .withMessage("latest must be a boolean"),
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("page must be a positive integer"),
    query("per_page")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("per_page must be between 1 and 50"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { connected_account_id, batch_id, latest } = req.query;

      const pagination = {
        page: parseInt(req.query.page) || 1,
        per_page: Math.min(parseInt(req.query.per_page) || 20, 50),
      };

      // Verify connected account belongs to user
      const connection = await ConnectedAccount.query()
        .findById(connected_account_id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connected account not found", 404));
      }

      // If latest=true, find the most recent batch_id first
      let latestBatchId = batch_id;
      if (latest === "true" && !batch_id) {
        const mostRecent = await PostSuggestion.query()
          .where("connected_account_id", connected_account_id)
          .whereNotNull("batch_id")
          .orderBy("created_at", "desc")
          .first()
          .select("batch_id");

        latestBatchId = mostRecent?.batch_id;
      }

      // Build base query
      let baseQuery = PostSuggestion.query()
        .where("connected_account_id", connected_account_id)
        .whereNull("dismissed_at");

      // Filter by batch_id if provided or if fetching latest
      if (latestBatchId) {
        baseQuery = baseQuery.where("batch_id", latestBatchId);
      }

      // Get total count
      const totalResult = await baseQuery.clone().count("id as count").first();
      const total = parseInt(totalResult?.count || 0, 10);

      // Get paginated results
      const suggestions = await baseQuery
        .withGraphFetched("[source_post.network_profile]")
        .orderBy("created_at", "desc")
        .limit(pagination.per_page)
        .offset((pagination.page - 1) * pagination.per_page);

      return res.status(200).json(paginatedResponse(
        suggestions.map(suggestionListSerializer),
        {
          page: pagination.page,
          per_page: pagination.per_page,
          total,
          has_more: pagination.page * pagination.per_page < total,
        }
      ));
    } catch (error) {
      console.error("Get suggestions error:", error);
      return res.status(500).json(formatError("Failed to retrieve suggestions"));
    }
  }
);

// GET /suggestions/status - Lightweight poll for suggestion generation status
router.get(
  "/status",
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

      // Verify connected account belongs to user and get timestamp
      const connection = await ConnectedAccount.query()
        .findById(connected_account_id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .select("id", "suggestions_update_started_at");

      if (!connection) {
        return res.status(404).json(formatError("Connected account not found", 404));
      }

      return res.status(200).json(successResponse({
        is_generating: connection.isSuggestionsGenerating(),
      }));
    } catch (error) {
      console.error("Get suggestion status error:", error);
      return res.status(500).json(formatError("Failed to retrieve suggestion status"));
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

          inspiringPosts = networkPosts;
        }
      }

      return res.status(200).json(successResponse(suggestionDetailSerializer(suggestion, inspiringPosts)));
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

      return res.status(200).json(successResponse(suggestionUseSerializer(suggestion, nextRecommended)));
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

      return res.status(200).json(successResponse(
        suggestionDismissSerializer(suggestion.dismissed_at || new Date().toISOString())
      ));
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
  requireSubscription("ghost_pro"),
  [
    ...suggestionParamValidators,
    body("angle")
      .optional()
      .isString()
      .isIn(["hot_take", "roast", "hype", "story", "teach", "question", "clean_up"])
      .withMessage("Angle must be one of: hot_take, roast, hype, story, teach, question, clean_up"),
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

      return res.status(202).json(successResponse(
        generateResponsePendingSerializer(artifact, input, suggestion.source_post, sourceAuthor)
      ));
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

      return res.status(200).json(successResponse(replyOpportunities.map(replyOpportunitySerializer)));
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
  requireSubscription("ghost_pro"),
  [
    body("connected_account_id")
      .isUUID()
      .withMessage("connected_account_id is required"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { connected_account_id } = req.body;

      // Verify connected account belongs to user and load sample posts count
      const connection = await ConnectedAccount.query()
        .findById(connected_account_id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .select(
          "connected_accounts.*",
          ConnectedAccount.relatedQuery("sample_posts").count().as("sample_posts_count")
        );

      if (!connection) {
        return res.status(404).json(formatError("Connected account not found", 404));
      }

      // Check if connection has enough context for generation
      if (!connection.isReadyForGeneration()) {
        return res.status(400).json(formatError(connection.getNotReadyReason(), 400));
      }

      // Mark generation started and trigger background job
      await connection.markSuggestionsUpdateStarted();
      const generationStartedAt = new Date().toISOString();
      const jobId = `gen-suggestions-${connection.id}`;

      await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, {
        connectedAccountId: connection.id,
        suggestionCount: 3,
        automated: true, // Set to true for testing push notifications
      }, {
        jobId,
      });

      return res.status(202).json(successResponse(
        generateSuggestionsQueuedSerializer(connection.id, generationStartedAt)
      ));
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
  requireSubscription("ghost_pro"),
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

      // Fetch trending topic and voice profile in parallel
      const [trendingTopic, voiceProfile] = await Promise.all([
        TrendingTopic.query()
          .findById(trending_topic_id)
          .withGraphFetched("curated_topic"),
        VoiceProfile.getCurrentProfile(connection.id),
      ]);

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

      // Get formatting preferences from connection
      const contentPrefs = connection.getContentPreferences();
      const formatting = {
        line_breaks: contentPrefs.line_breaks,
        emojis: contentPrefs.emojis,
      };

      // Generate with AI service
      const result = await AI.generatePost({
        topic: prompt,
        voiceProfile: voiceProfile?.toPromptFormat(),
        bio: connection.bio,
        contentType: selectedContentType,
        platform: connection.platform,
        maxLength: 500,
        formatting,
      });

      const generatedContent = result.content;

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

      return res.status(201).json(successResponse(
        suggestionFromTopicSerializer(suggestion, trendingTopic, nextType)
      ));
    } catch (error) {
      console.error("Generate from trending topic error:", error);
      return res.status(500).json(formatError("Failed to generate suggestion from trending topic"));
    }
  }
);

export default router;
