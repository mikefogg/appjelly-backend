import express from "express";
import { param, body } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors } from "#src/middleware/index.js";
import { Input, Artifact, ConnectedAccount } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import { successResponse, paginatedResponse } from "#src/serializers/index.js";
import { ghostQueue, JOB_GENERATE_POST } from "#src/background/queues/index.js";
import  aiService from "#src/helpers/ai-service.js";

const router = express.Router({ mergeParams: true });

const postParamValidators = [
  param("id").isUUID().withMessage("Invalid post ID"),
];

// POST /posts/drafts - Create a user-written draft
router.post(
  "/drafts",
  requireAppContext,
  requireAuth,
  [
    body("content")
      .isString()
      .trim()
      .isLength({ min: 1, max: 5000 })
      .withMessage("Content must be between 1 and 5000 characters"),
    body("connected_account_id")
      .optional()
      .isUUID()
      .withMessage("connected_account_id must be a valid UUID"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { content, connected_account_id } = req.body;

      let connection = null;
      let platform = null;

      // If connected_account_id provided, verify it belongs to user
      // Otherwise, use the default ghost account
      if (connected_account_id) {
        connection = await ConnectedAccount.query()
          .findById(connected_account_id)
          .where("account_id", res.locals.account.id)
          .where("app_id", res.locals.app.id);

        if (!connection) {
          return res.status(404).json(formatError("Connected account not found", 404));
        }
        platform = connection.platform;
      } else {
        // Use ghost account for standalone posts
        connection = await ConnectedAccount.findOrCreateGhostAccount(
          res.locals.account.id,
          res.locals.app.id
        );
        platform = "ghost";
      }

      // Create draft artifact (no input_id)
      const artifact = await Artifact.query().insert({
        account_id: res.locals.account.id,
        app_id: res.locals.app.id,
        connected_account_id: connection.id,
        artifact_type: "social_post",
        status: "draft",
        content,
        metadata: {
          platform,
          source: "user",
          mode: platform === "ghost" ? "standalone" : "connected",
        },
      });

      const data = {
        id: artifact.id,
        status: "draft",
        content: artifact.content,
        character_count: content.length,
        connected_account: {
          id: connection.id,
          platform: connection.platform,
          username: connection.username,
        },
        created_at: artifact.created_at,
      };

      return res.status(201).json(successResponse(data));
    } catch (error) {
      console.error("Create draft error:", error);
      return res.status(500).json(formatError("Failed to create draft"));
    }
  }
);

// POST /posts/generate - Generate a post from a prompt
router.post(
  "/generate",
  requireAppContext,
  requireAuth,
  [
    body("prompt")
      .isString()
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage("Prompt must be between 1 and 500 characters"),
    body("angle")
      .isString()
      .isIn(["hot_take", "roast", "hype", "story", "teach", "question"])
      .withMessage("Angle must be one of: hot_take, roast, hype, story, teach, question"),
    body("length")
      .isString()
      .isIn(["short", "medium", "long"])
      .withMessage("Length must be one of: short, medium, long"),
    body("connected_account_id")
      .optional()
      .isUUID()
      .withMessage("connected_account_id must be a valid UUID"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { prompt, angle, length, connected_account_id } = req.body;

      let connection = null;
      let platform = null;

      // If connected_account_id provided, verify it belongs to user
      // Otherwise, use the default ghost account
      if (connected_account_id) {
        connection = await ConnectedAccount.query()
          .findById(connected_account_id)
          .where("account_id", res.locals.account.id)
          .where("app_id", res.locals.app.id);

        if (!connection) {
          return res.status(404).json(formatError("Connected account not found", 404));
        }

        platform = connection.platform;
      } else {
        // Use ghost account for standalone posts
        connection = await ConnectedAccount.findOrCreateGhostAccount(
          res.locals.account.id,
          res.locals.app.id
        );
        platform = "ghost";
      }

      // Create input
      const input = await Input.query().insert({
        account_id: res.locals.account.id,
        app_id: res.locals.app.id,
        connected_account_id: connection.id,
        prompt,
        metadata: {
          platform,
          mode: platform === "ghost" ? "standalone" : "connected",
          angle,
          length,
        },
      });

      // Create artifact (pending generation)
      const artifact = await Artifact.query().insert({
        input_id: input.id,
        account_id: res.locals.account.id,
        app_id: res.locals.app.id,
        connected_account_id: connection.id,
        artifact_type: "social_post",
        status: "pending",
        metadata: {
          platform,
          prompt,
          angle,
          length,
          mode: platform === "ghost" ? "standalone" : "connected",
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
        message: "Post generation queued",
        input: {
          id: input.id,
          prompt: input.prompt,
        },
        connected_account: {
          id: connection.id,
          platform: connection.platform,
          username: connection.username,
        },
      };

      return res.status(202).json(successResponse(data));
    } catch (error) {
      console.error("Generate post error:", error);
      return res.status(500).json(formatError("Failed to generate post"));
    }
  }
);

// GET /posts - List posts (drafts and/or generated)
router.get(
  "/",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const pagination = {
        page: parseInt(req.query.page) || 1,
        per_page: Math.min(parseInt(req.query.per_page) || 20, 50),
      };

      const connectedAccountId = req.query.connected_account_id;
      const type = req.query.type; // "draft", "generated", or "all" (default)
      const sort = req.query.sort || "created_at"; // "created_at" or "updated_at"
      const order = req.query.order || "desc"; // "asc" or "desc"

      // Validate sort parameter
      const allowedSortFields = ["created_at", "updated_at"];
      const sortField = allowedSortFields.includes(sort) ? sort : "created_at";
      const sortOrder = ["asc", "desc"].includes(order) ? order : "desc";

      let query = Artifact.query()
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .where("artifact_type", "social_post")
        .withGraphFetched("[input, connected_account]")
        .orderBy(sortField, sortOrder);

      // Filter by connection
      if (connectedAccountId === "none") {
        // Fetch only standalone posts (posts without any connected account)
        query = query.whereNull("connected_account_id");
      } else if (connectedAccountId && connectedAccountId !== "undefined") {
        // Fetch posts for a specific connection (skip if undefined/null/empty)
        query = query.where("connected_account_id", connectedAccountId);
      }
      // No filter or invalid value: return all posts for the user

      // Filter by type
      if (type === "draft") {
        query = query.where("status", "draft").whereNull("input_id");
      } else if (type === "generated") {
        query = query.whereNotNull("input_id");
      }
      // type === "all" or undefined: return both

      const artifacts = await query.page(pagination.page - 1, pagination.per_page);

      const data = artifacts.results.map(artifact => ({
        id: artifact.id,
        status: artifact.status,
        content: artifact.content,
        character_count: artifact.content?.length || 0,
        is_draft: artifact.isDraft(),
        angle: artifact.input?.metadata?.angle || artifact.metadata?.angle || null,
        length: artifact.input?.metadata?.length || artifact.metadata?.length || null,
        topics: artifact.metadata?.topics || [],
        input: artifact.input ? {
          id: artifact.input.id,
          prompt: artifact.input.prompt,
        } : null,
        connected_account: artifact.connected_account ? {
          id: artifact.connected_account.id,
          platform: artifact.connected_account.platform,
          username: artifact.connected_account.username,
        } : null,
        created_at: artifact.created_at,
        updated_at: artifact.updated_at,
      }));

      return res.status(200).json(paginatedResponse(data, {
        ...pagination,
        total: artifacts.total,
        has_more: artifacts.results.length === pagination.per_page,
      }));
    } catch (error) {
      console.error("Get posts error:", error);
      return res.status(500).json(formatError("Failed to retrieve posts"));
    }
  }
);

// GET /posts/:id - Get specific post
router.get(
  "/:id",
  requireAppContext,
  requireAuth,
  postParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const artifact = await Artifact.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .where("artifact_type", "social_post")
        .withGraphFetched("[input, connected_account]");

      if (!artifact) {
        return res.status(404).json(formatError("Post not found", 404));
      }

      const data = {
        id: artifact.id,
        status: artifact.status,
        content: artifact.content,
        character_count: artifact.content?.length || 0,
        angle: artifact.input?.metadata?.angle || artifact.metadata?.angle || null,
        length: artifact.input?.metadata?.length || artifact.metadata?.length || null,
        topics: artifact.metadata?.topics || [],
        input: artifact.input ? {
          id: artifact.input.id,
          prompt: artifact.input.prompt,
        } : null,
        connected_account: artifact.connected_account ? {
          id: artifact.connected_account.id,
          platform: artifact.connected_account.platform,
          username: artifact.connected_account.username,
        } : null,
        generation_info: {
          total_tokens: artifact.total_tokens,
          cost_usd: artifact.cost_usd,
          generation_time_seconds: artifact.generation_time_seconds,
          ai_model: artifact.ai_model,
        },
        metadata: artifact.metadata,
        created_at: artifact.created_at,
        updated_at: artifact.updated_at,
      };

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get post error:", error);
      return res.status(500).json(formatError("Failed to retrieve post"));
    }
  }
);

// PATCH /posts/:id - Edit post content
router.patch(
  "/:id",
  requireAppContext,
  requireAuth,
  [
    ...postParamValidators,
    body("content")
      .isString()
      .trim()
      .isLength({ min: 1, max: 5000 })
      .withMessage("Content must be between 1 and 5000 characters"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { content } = req.body;

      const artifact = await Artifact.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .where("artifact_type", "social_post");

      if (!artifact) {
        return res.status(404).json(formatError("Post not found", 404));
      }

      await artifact.$query().patch({
        content,
        metadata: {
          ...artifact.metadata,
          edited: true,
          edited_at: new Date().toISOString(),
        },
      });

      return res.status(200).json(successResponse({
        id: artifact.id,
        content,
        message: "Post updated successfully",
      }));
    } catch (error) {
      console.error("Update post error:", error);
      return res.status(500).json(formatError("Failed to update post"));
    }
  }
);

// POST /posts/:id/improve - Get AI improvement suggestions (preview-only)
router.post(
  "/:id/improve",
  requireAppContext,
  requireAuth,
  [
    ...postParamValidators,
    body("instructions")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage("Instructions must be between 1 and 200 characters"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { instructions } = req.body;

      const artifact = await Artifact.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .where("artifact_type", "social_post")
        .withGraphFetched("connected_account");

      if (!artifact) {
        return res.status(404).json(formatError("Post not found", 404));
      }

      if (!artifact.content) {
        return res.status(400).json(formatError("Post has no content to improve", 400));
      }

      // Build AI prompt for improvement
      const improvementPrompt = instructions
        ? `Improve this social media post with the following instructions: "${instructions}"\n\nOriginal post:\n${artifact.content}`
        : `Improve this social media post while keeping the core message and tone:\n\n${artifact.content}`;

      // Get AI improvement (without saving)
      const startTime = Date.now();
      const aiResponse = await aiService.generateText(improvementPrompt, {
        maxTokens: 500,
        temperature: 0.7,
      });
      const generationTime = (Date.now() - startTime) / 1000;

      const data = {
        original: {
          content: artifact.content,
          character_count: artifact.content.length,
        },
        improved: {
          content: aiResponse.text,
          character_count: aiResponse.text.length,
        },
        instructions: instructions || null,
        generation_info: {
          total_tokens: aiResponse.usage.totalTokens,
          cost_usd: aiResponse.cost,
          generation_time_seconds: generationTime,
          ai_model: aiResponse.model,
        },
        message: "AI improvement generated. Use PATCH /posts/:id to save if you like it.",
      };

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Improve post error:", error);
      return res.status(500).json(formatError("Failed to improve post"));
    }
  }
);

// POST /posts/:id/copy - Mark post as copied (user copied to clipboard)
router.post(
  "/:id/copy",
  requireAppContext,
  requireAuth,
  postParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const artifact = await Artifact.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .where("artifact_type", "social_post");

      if (!artifact) {
        return res.status(404).json(formatError("Post not found", 404));
      }

      await artifact.$query().patch({
        metadata: {
          ...artifact.metadata,
          copied: true,
          copied_at: new Date().toISOString(),
        },
      });

      return res.status(200).json(successResponse({
        message: "Post marked as copied",
      }));
    } catch (error) {
      console.error("Copy post error:", error);
      return res.status(500).json(formatError("Failed to mark post as copied"));
    }
  }
);

// DELETE /posts/:id - Delete a post
router.delete(
  "/:id",
  requireAppContext,
  requireAuth,
  postParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const artifact = await Artifact.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .where("artifact_type", "social_post");

      if (!artifact) {
        return res.status(404).json(formatError("Post not found", 404));
      }

      await artifact.$query().delete();

      return res.status(200).json(successResponse({
        message: "Post deleted successfully",
      }));
    } catch (error) {
      console.error("Delete post error:", error);
      return res.status(500).json(formatError("Failed to delete post"));
    }
  }
);

export default router;
