import express from "express";
import { param, query, body } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors } from "#src/middleware/index.js";
import { PostSuggestion, ConnectedAccount, Input, Artifact } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import { successResponse } from "#src/serializers/index.js";
import { ghostQueue, JOB_GENERATE_SUGGESTIONS, JOB_GENERATE_POST } from "#src/background/queues/index.js";

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

      // Get active suggestions
      const suggestions = await PostSuggestion.query()
        .where("connected_account_id", connected_account_id)
        .where("status", "pending")
        .where("expires_at", ">", new Date().toISOString())
        .withGraphFetched("[source_post.network_profile]")
        .orderBy("created_at", "desc");

      const data = suggestions.map(suggestion => ({
        id: suggestion.id,
        suggestion_type: suggestion.suggestion_type,
        content: suggestion.content,
        reasoning: suggestion.reasoning,
        character_count: suggestion.character_count,
        topics: suggestion.topics,
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

      const data = {
        id: suggestion.id,
        suggestion_type: suggestion.suggestion_type,
        content: suggestion.content,
        reasoning: suggestion.reasoning,
        character_count: suggestion.character_count,
        topics: suggestion.topics,
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

// POST /suggestions/:id/use - Mark suggestion as used
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
        .where("app_id", res.locals.app.id);

      if (!suggestion) {
        return res.status(404).json(formatError("Suggestion not found", 404));
      }

      if (suggestion.status !== "pending") {
        return res.status(400).json(formatError("Suggestion has already been used or dismissed", 400));
      }

      await suggestion.markAsUsed();

      return res.status(200).json(successResponse({
        message: "Suggestion marked as used",
        status: "used",
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

      if (suggestion.status !== "pending") {
        return res.status(400).json(formatError("Suggestion has already been used or dismissed", 400));
      }

      await suggestion.markAsDismissed();

      return res.status(200).json(successResponse({
        message: "Suggestion dismissed",
        status: "dismissed",
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
      const { additional_instructions } = req.body;

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

      if (suggestion.connected_account.sync_status !== "ready") {
        return res.status(400).json(formatError("Connected account is not ready. Please wait for initial sync to complete.", 400));
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

// POST /suggestions/generate - Manually trigger suggestion generation
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

      if (connection.sync_status !== "ready") {
        return res.status(400).json(formatError("Connected account must be synced before generating suggestions", 400));
      }

      // Trigger background job
      await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, {
        connectedAccountId: connection.id,
        suggestionCount: 3,
      });

      return res.status(202).json(successResponse({
        message: "Suggestion generation queued",
      }));
    } catch (error) {
      console.error("Generate suggestions error:", error);
      return res.status(500).json(formatError("Failed to trigger suggestion generation"));
    }
  }
);

export default router;
