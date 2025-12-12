import express from "express";
import { param, body } from "express-validator";
import { requireAuth, requireAppContext, requireSubscription, handleValidationErrors } from "#src/middleware/index.js";
import { Input, Artifact, ConnectedAccount, VoiceProfile, ArtifactVersion } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import {
  successResponse,
  paginatedResponse,
  postListSerializer,
  postDetailSerializer,
  draftCreateSerializer,
  postGeneratePendingSerializer,
  postUpdateSerializer,
  postImprovementSerializer,
  versionListSerializer,
  versionDetailSerializer,
  rollbackSerializer,
  messageResponse,
} from "#src/serializers/index.js";
import { ghostQueue, JOB_GENERATE_POST } from "#src/background/queues/index.js";
import AI from "#src/services/ai/index.js";

const router = express.Router({ mergeParams: true });

const postParamValidators = [
  param("id").isUUID().withMessage("Invalid post ID"),
];

const versionParamValidators = [
  param("id").isUUID().withMessage("Invalid post ID"),
  param("version_number").isInt({ min: 1 }).withMessage("Version number must be a positive integer"),
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
      .isUUID()
      .withMessage("connected_account_id is required and must be a valid UUID"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { content, connected_account_id } = req.body;

      const connection = await ConnectedAccount.query()
        .findById(connected_account_id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connected account not found", 404));
      }

      // Create draft artifact (no input_id)
      const artifact = await Artifact.query().insert({
        account_id: res.locals.account.id,
        app_id: res.locals.app.id,
        connected_account_id: connection.id,
        artifact_type: "social_post",
        status: "draft",
        content,
        current_version_number: 1,
        metadata: {
          platform: connection.platform,
          source: "user",
          mode: connection.platform === "ghost" ? "standalone" : "connected",
        },
      });

      // Create initial version
      await artifact.createInitialVersion("creation");

      return res.status(201).json(successResponse(draftCreateSerializer(artifact, connection)));
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
  requireSubscription("ghost_pro"),
  [
    body("prompt")
      .isString()
      .trim()
      .isLength({ min: 1, max: 5000 })
      .withMessage("Prompt must be between 1 and 5000 characters"),
    body("angle")
      .isString()
      .isIn(["hot_take", "roast", "hype", "story", "teach", "question", "clean_up"])
      .withMessage("Angle must be one of: hot_take, roast, hype, story, teach, question, clean_up"),
    body("length")
      .isString()
      .isIn(["short", "medium", "long"])
      .withMessage("Length must be one of: short, medium, long"),
    body("connected_account_id")
      .isUUID()
      .withMessage("connected_account_id is required and must be a valid UUID"),
    body("line_breaks")
      .optional()
      .isIn(["minimal", "moderate", "frequent"])
      .withMessage("line_breaks must be 'minimal', 'moderate', or 'frequent'"),
    body("emojis")
      .optional()
      .isIn(["none", "sparse", "moderate", "heavy"])
      .withMessage("emojis must be 'none', 'sparse', 'moderate', or 'heavy'"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { prompt, angle, length, connected_account_id, line_breaks, emojis } = req.body;

      const connection = await ConnectedAccount.query()
        .findById(connected_account_id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connected account not found", 404));
      }

      // Check if connection is ready (only for non-ghost accounts)
      if (connection.platform !== "ghost" && connection.sync_status !== "ready") {
        return res.status(400).json(formatError("Connected account is not ready. Please wait for sync to complete.", 400));
      }

      const platform = connection.platform;

      // Determine formatting (use overrides if provided, else connection defaults)
      const contentPrefs = connection.getContentPreferences();
      const formatting = {
        line_breaks: line_breaks || contentPrefs.line_breaks,
        emojis: emojis || contentPrefs.emojis,
      };

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
          formatting,
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
          formatting,
          mode: platform === "ghost" ? "standalone" : "connected",
        },
      });

      // Trigger background job for AI generation
      await ghostQueue.add(JOB_GENERATE_POST, {
        artifactId: artifact.id,
      });

      return res.status(202).json(successResponse(postGeneratePendingSerializer(artifact, input, connection)));
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
      } else if (type === "used") {
        query = query.whereRaw("metadata->>'copied' = 'true'");
      }
      // type === "all" or undefined: return both

      const artifacts = await query.page(pagination.page - 1, pagination.per_page);

      return res.status(200).json(paginatedResponse(artifacts.results.map(postListSerializer), {
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

      return res.status(200).json(successResponse(postDetailSerializer(artifact)));
    } catch (error) {
      console.error("Get post error:", error);
      return res.status(500).json(formatError("Failed to retrieve post"));
    }
  }
);

// PATCH /posts/:id - Edit post content (updates current version in place)
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

      // Check if artifact has any versions yet (for pre-existing drafts)
      const versionCount = await artifact.getVersionCount();
      if (versionCount === 0 && artifact.content) {
        // Create v1 from current content before updating
        await artifact.createInitialVersion(artifact.input_id ? "generation" : "creation");
      }

      // Update artifact content and sync to current version
      await artifact.updateContentWithVersion(content);

      // Update metadata
      await artifact.$query().patch({
        metadata: {
          ...artifact.metadata,
          edited: true,
          edited_at: new Date().toISOString(),
        },
      });

      return res.status(200).json(successResponse(postUpdateSerializer(artifact, content)));
    } catch (error) {
      console.error("Update post error:", error);
      return res.status(500).json(formatError("Failed to update post"));
    }
  }
);

// POST /posts/:id/improve - AI improvement that creates a new version
router.post(
  "/:id/improve",
  requireAppContext,
  requireAuth,
  requireSubscription("ghost_pro"),
  [
    ...postParamValidators,
    body("instructions")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 5000 })
      .withMessage("Instructions must be between 1 and 5000 characters"),
    body("adjust_length")
      .optional()
      .isIn(["shrink", "expand"])
      .withMessage("adjust_length must be 'shrink' or 'expand'"),
    body("length")
      .optional()
      .isIn(["short", "medium", "long"])
      .withMessage("length must be 'short', 'medium', or 'long'"),
    body("line_breaks")
      .optional()
      .isIn(["minimal", "moderate", "frequent"])
      .withMessage("line_breaks must be 'minimal', 'moderate', or 'frequent'"),
    body("emojis")
      .optional()
      .isIn(["none", "sparse", "moderate", "heavy"])
      .withMessage("emojis must be 'none', 'sparse', 'moderate', or 'heavy'"),
    body("hashtags")
      .optional()
      .isIn(["none", "minimal", "moderate"])
      .withMessage("hashtags must be 'none', 'minimal', or 'moderate'"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { instructions, adjust_length, length, line_breaks, emojis, hashtags } = req.body;

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

      // Check if artifact has any versions yet (for pre-existing drafts)
      const versionCount = await artifact.getVersionCount();
      if (versionCount === 0) {
        // Create v1 from current content before improving
        await artifact.createInitialVersion(artifact.input_id ? "generation" : "creation");
      }

      // Store original content for response
      const originalContent = artifact.content;

      // Get platform and connection
      const connection = artifact.connected_account;
      const platform = connection?.platform || "ghost";

      // Determine target length
      const {
        getLengthBucket,
        getNextBucketUp,
        getNextBucketDown,
        getTargetLength,
      } = await import("#src/config/platform-lengths.js");

      let targetLength = null;
      let targetBucket = null;

      if (length) {
        // Absolute length specified
        targetBucket = length;
        targetLength = getTargetLength(platform, length);
      } else if (adjust_length) {
        // Relative adjustment
        const currentBucket = getLengthBucket(platform, artifact.content.length);
        targetBucket = adjust_length === "expand"
          ? getNextBucketUp(currentBucket)
          : getNextBucketDown(currentBucket);

        if (targetBucket) {
          targetLength = getTargetLength(platform, targetBucket);
        }
        // If null (already at min/max), we'll just improve without length change
      }

      // Build length instruction for AI
      let lengthInstruction = "";
      if (targetLength && targetBucket) {
        if (targetBucket === "long" && platform === "twitter") {
          lengthInstruction = `\n\nTARGET LENGTH: Expand to approximately ${targetLength} characters. Keep a compelling hook in the first 280 characters to encourage readers to click "Show more".`;
        } else if (targetBucket === "long" && platform === "linkedin") {
          lengthInstruction = `\n\nTARGET LENGTH: Expand to approximately ${targetLength} characters. Keep the first 150 characters as a strong hook before the "See more" cutoff.`;
        } else if (artifact.content.length > targetLength) {
          lengthInstruction = `\n\nTARGET LENGTH: Condense to approximately ${targetLength} characters while preserving the core message.`;
        } else {
          lengthInstruction = `\n\nTARGET LENGTH: Expand to approximately ${targetLength} characters with more detail and depth.`;
        }
      }

      // Build topic for improvement
      let improvementTopic;
      if (instructions || lengthInstruction) {
        improvementTopic = `Improve this post${instructions ? ` with the following instructions: "${instructions}"` : ""}.${lengthInstruction}${!lengthInstruction ? "\n\nIMPORTANT: Keep the same approximate length unless otherwise specified." : ""}

Original post:
${artifact.content}`;
      } else {
        improvementTopic = `Improve this post while keeping the core message, tone, and similar length:

${artifact.content}`;
      }

      // Get voice profile for this connected account
      const voiceProfile = connection
        ? await VoiceProfile.getCurrentProfile(connection.id)
        : null;

      // Determine formatting preferences (use overrides if provided, else connection defaults)
      const contentPrefs = connection?.getContentPreferences() || {};
      const formattingOverrides = {
        line_breaks: line_breaks || contentPrefs.line_breaks,
        emojis: emojis || contentPrefs.emojis,
        hashtags: hashtags || contentPrefs.hashtags,
      };

      // Get AI improvement
      const startTime = Date.now();
      const result = await AI.generatePost({
        topic: improvementTopic,
        voiceProfile: voiceProfile?.toPromptFormat(),
        bio: connection?.bio,
        platform,
        maxLength: targetLength || 5000,
        formatting: formattingOverrides,
      });
      const generationTime = (Date.now() - startTime) / 1000;

      // Create new version with improved content
      const newVersion = await artifact.createVersion(result.content, "improvement", {
        instructions: instructions || null,
        adjust_length: adjust_length || null,
        target_length: targetBucket || null,
        formatting: formattingOverrides,
      });

      return res.status(200).json(successResponse(
        postImprovementSerializer(
          { ...artifact, content: originalContent }, // Pass original content
          result.content,
          instructions,
          result.metadata,
          generationTime,
          newVersion
        )
      ));
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

      return res.status(200).json(successResponse(messageResponse("Post marked as copied")));
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

      return res.status(200).json(successResponse(messageResponse("Post deleted successfully")));
    } catch (error) {
      console.error("Delete post error:", error);
      return res.status(500).json(formatError("Failed to delete post"));
    }
  }
);

// GET /posts/:id/versions - List all versions for a post
router.get(
  "/:id/versions",
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

      const versions = await artifact.getVersions();

      return res.status(200).json(successResponse(
        versionListSerializer(artifact.id, artifact.current_version_number || 1, versions)
      ));
    } catch (error) {
      console.error("List versions error:", error);
      return res.status(500).json(formatError("Failed to list versions"));
    }
  }
);

// GET /posts/:id/versions/:version_number - Get a specific version
router.get(
  "/:id/versions/:version_number",
  requireAppContext,
  requireAuth,
  versionParamValidators,
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

      const versionNumber = parseInt(req.params.version_number, 10);
      const version = await artifact.getVersion(versionNumber);

      if (!version) {
        return res.status(404).json(formatError(`Version ${versionNumber} not found`, 404));
      }

      return res.status(200).json(successResponse(
        versionDetailSerializer(version, artifact.current_version_number || 1)
      ));
    } catch (error) {
      console.error("Get version error:", error);
      return res.status(500).json(formatError("Failed to get version"));
    }
  }
);

// POST /posts/:id/versions/:version_number/rollback - Rollback to a specific version
router.post(
  "/:id/versions/:version_number/rollback",
  requireAppContext,
  requireAuth,
  versionParamValidators,
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

      const versionNumber = parseInt(req.params.version_number, 10);

      // Check if target version exists
      const targetVersion = await artifact.getVersion(versionNumber);
      if (!targetVersion) {
        return res.status(404).json(formatError(`Version ${versionNumber} not found`, 404));
      }

      // Rollback creates a new version with the old content
      const newVersion = await artifact.rollbackToVersion(versionNumber);

      // Refetch artifact with updated content
      const updatedArtifact = await Artifact.query().findById(artifact.id);

      return res.status(200).json(successResponse(
        rollbackSerializer(updatedArtifact, newVersion, versionNumber)
      ));
    } catch (error) {
      console.error("Rollback error:", error);
      return res.status(500).json(formatError("Failed to rollback to version"));
    }
  }
);

export default router;
