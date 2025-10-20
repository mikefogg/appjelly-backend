import express from "express";
import { param, body } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors } from "#src/middleware/index.js";
import { ConnectedAccount, SamplePost } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import { successResponse } from "#src/serializers/index.js";
import { ghostQueue, JOB_SYNC_NETWORK, JOB_ANALYZE_STYLE } from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

const connectionParamValidators = [
  param("id").isUUID().withMessage("Invalid connection ID"),
];

// GET /connections - List all connected accounts for user
router.get(
  "/",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const connections = await ConnectedAccount.findByAccountAndApp(
        res.locals.account.id,
        res.locals.app.id
      );

      const data = connections.map(conn => ({
        id: conn.id,
        platform: conn.platform,
        platform_user_id: conn.platform_user_id,
        username: conn.username,
        display_name: conn.display_name,
        profile_data: conn.profile_data,
        sync_status: conn.sync_status,
        last_synced_at: conn.last_synced_at,
        last_analyzed_at: conn.last_analyzed_at,
        is_active: conn.is_active,
        is_default: conn.is_default,
        is_deletable: conn.is_deletable,
        voice: conn.voice,
        topics_of_interest: conn.topics_of_interest,
        created_at: conn.created_at,
      }));

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get connections error:", error);
      return res.status(500).json(formatError("Failed to retrieve connections"));
    }
  }
);

// GET /connections/:id - Get specific connection
router.get(
  "/:id",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[writing_style]");

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      const data = {
        id: connection.id,
        platform: connection.platform,
        platform_user_id: connection.platform_user_id,
        username: connection.username,
        display_name: connection.display_name,
        profile_data: connection.profile_data,
        sync_status: connection.sync_status,
        last_synced_at: connection.last_synced_at,
        last_analyzed_at: connection.last_analyzed_at,
        is_active: connection.is_active,
        is_default: connection.is_default,
        is_deletable: connection.is_deletable,
        voice: connection.voice,
        topics_of_interest: connection.topics_of_interest,
        writing_style: connection.writing_style ? {
          tone: connection.writing_style.tone,
          avg_length: connection.writing_style.avg_length,
          style_summary: connection.writing_style.style_summary,
          confidence_score: connection.writing_style.confidence_score,
          sample_size: connection.writing_style.sample_size,
        } : null,
        created_at: connection.created_at,
      };

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get connection error:", error);
      return res.status(500).json(formatError("Failed to retrieve connection"));
    }
  }
);

// GET /connections/:id/status - Check sync status
router.get(
  "/:id/status",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      const data = {
        sync_status: connection.sync_status,
        last_synced_at: connection.last_synced_at,
        last_analyzed_at: connection.last_analyzed_at,
        needs_sync: connection.needsSync(),
        needs_analysis: connection.needsAnalysis(),
        error: connection.metadata?.last_error || null,
      };

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get connection status error:", error);
      return res.status(500).json(formatError("Failed to retrieve connection status"));
    }
  }
);

// PATCH /connections/:id/sync - Trigger manual sync
router.patch(
  "/:id/sync",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Mark as syncing
      await connection.markAsSyncing();

      // Trigger background jobs to sync network and analyze style in parallel
      await Promise.all([
        ghostQueue.add(JOB_SYNC_NETWORK, {
          connectedAccountId: connection.id,
        }),
        ghostQueue.add(JOB_ANALYZE_STYLE, {
          connectedAccountId: connection.id,
        }),
      ]);

      return res.status(200).json(successResponse({
        message: "Sync initiated",
        sync_status: "syncing",
      }));
    } catch (error) {
      console.error("Sync connection error:", error);
      return res.status(500).json(formatError("Failed to sync connection"));
    }
  }
);

// PATCH /connections/:id - Update connection settings (voice, topics)
router.patch(
  "/:id",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    body("voice")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 2000 })
      .withMessage("Voice must be under 2000 characters"),
    body("topics_of_interest")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 2000 })
      .withMessage("Topics of interest must be under 2000 characters"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { voice, topics_of_interest } = req.body;

      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Update voice and topics
      const updates = {};
      if (voice !== undefined) updates.voice = voice;
      if (topics_of_interest !== undefined) updates.topics_of_interest = topics_of_interest;

      await connection.$query().patch(updates);

      return res.status(200).json(successResponse({
        id: connection.id,
        voice: voice !== undefined ? voice : connection.voice,
        topics_of_interest: topics_of_interest !== undefined ? topics_of_interest : connection.topics_of_interest,
        message: "Connection updated successfully",
      }));
    } catch (error) {
      console.error("Update connection error:", error);
      return res.status(500).json(formatError("Failed to update connection"));
    }
  }
);

// DELETE /connections/:id - Disconnect account
router.delete(
  "/:id",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Prevent deletion of default ghost account
      if (!connection.is_deletable) {
        return res.status(403).json(formatError("This account cannot be deleted", 403));
      }

      // Soft delete by marking as inactive
      await connection.$query().patch({ is_active: false });

      return res.status(200).json(successResponse({
        message: "Connection disconnected successfully",
      }));
    } catch (error) {
      console.error("Delete connection error:", error);
      return res.status(500).json(formatError("Failed to disconnect account"));
    }
  }
);

// POST /connections/:id/samples - Create a sample post
router.post(
  "/:id/samples",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    body("content")
      .isString()
      .trim()
      .isLength({ min: 1, max: 5000 })
      .withMessage("Content must be between 1 and 5000 characters"),
    body("notes")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Notes must be under 500 characters"),
    body("sort_order")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Sort order must be a non-negative integer"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { content, notes, sort_order } = req.body;

      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Create sample post
      const samplePost = await SamplePost.query().insert({
        connected_account_id: connection.id,
        content,
        notes: notes || null,
        sort_order: sort_order !== undefined ? sort_order : 0,
      });

      const data = {
        id: samplePost.id,
        content: samplePost.content,
        notes: samplePost.notes,
        sort_order: samplePost.sort_order,
        created_at: samplePost.created_at,
      };

      return res.status(201).json(successResponse(data));
    } catch (error) {
      console.error("Create sample post error:", error);
      return res.status(500).json(formatError("Failed to create sample post"));
    }
  }
);

// GET /connections/:id/samples - List sample posts
router.get(
  "/:id/samples",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Get sample posts ordered by sort_order
      const samplePosts = await SamplePost.query()
        .where("connected_account_id", connection.id)
        .orderBy("sort_order", "asc")
        .orderBy("created_at", "asc");

      const data = samplePosts.map(sp => ({
        id: sp.id,
        content: sp.content,
        notes: sp.notes,
        sort_order: sp.sort_order,
        created_at: sp.created_at,
        updated_at: sp.updated_at,
      }));

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get sample posts error:", error);
      return res.status(500).json(formatError("Failed to retrieve sample posts"));
    }
  }
);

// PATCH /connections/:id/samples/:sampleId - Update a sample post
router.patch(
  "/:id/samples/:sampleId",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    param("sampleId").isUUID().withMessage("Invalid sample post ID"),
    body("content")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 5000 })
      .withMessage("Content must be between 1 and 5000 characters"),
    body("notes")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Notes must be under 500 characters"),
    body("sort_order")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Sort order must be a non-negative integer"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { content, notes, sort_order } = req.body;

      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Find and verify sample post belongs to this connection
      const samplePost = await SamplePost.query()
        .findById(req.params.sampleId)
        .where("connected_account_id", connection.id);

      if (!samplePost) {
        return res.status(404).json(formatError("Sample post not found", 404));
      }

      // Build update object
      const updates = {};
      if (content !== undefined) updates.content = content;
      if (notes !== undefined) updates.notes = notes;
      if (sort_order !== undefined) updates.sort_order = sort_order;

      // Update sample post
      const updated = await samplePost.$query().patchAndFetch(updates);

      const data = {
        id: updated.id,
        content: updated.content,
        notes: updated.notes,
        sort_order: updated.sort_order,
        updated_at: updated.updated_at,
      };

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Update sample post error:", error);
      return res.status(500).json(formatError("Failed to update sample post"));
    }
  }
);

// DELETE /connections/:id/samples/:sampleId - Delete a sample post
router.delete(
  "/:id/samples/:sampleId",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    param("sampleId").isUUID().withMessage("Invalid sample post ID"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Find and verify sample post belongs to this connection
      const samplePost = await SamplePost.query()
        .findById(req.params.sampleId)
        .where("connected_account_id", connection.id);

      if (!samplePost) {
        return res.status(404).json(formatError("Sample post not found", 404));
      }

      // Delete sample post
      await samplePost.$query().delete();

      return res.status(200).json(successResponse({
        message: "Sample post deleted successfully",
      }));
    } catch (error) {
      console.error("Delete sample post error:", error);
      return res.status(500).json(formatError("Failed to delete sample post"));
    }
  }
);

export default router;
