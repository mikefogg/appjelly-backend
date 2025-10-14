import express from "express";
import { param, query, body } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors } from "#src/middleware/index.js";
import { PostSuggestion, ConnectedAccount } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import { successResponse } from "#src/serializers/index.js";
import { ghostQueue, JOB_GENERATE_SUGGESTIONS } from "#src/background/queues/index.js";

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
