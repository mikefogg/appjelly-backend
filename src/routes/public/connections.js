import express from "express";
import { param } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors } from "#src/middleware/index.js";
import { ConnectedAccount } from "#src/models/index.js";
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

      // Trigger background jobs to sync network and analyze style
      await ghostQueue.add(JOB_SYNC_NETWORK, {
        connectedAccountId: connection.id,
      });

      // After sync, trigger style analysis
      await ghostQueue.add(JOB_ANALYZE_STYLE, {
        connectedAccountId: connection.id,
      }, {
        delay: 30000, // Wait 30 seconds after sync starts
      });

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

export default router;
