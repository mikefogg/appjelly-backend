import express from "express";
import { body, param } from "express-validator";
import {
  requireAuth,
  requireAppContext,
  handleValidationErrors,
  rateLimitByAccount,
} from "#src/middleware/index.js";
import { Media } from "#src/models/index.js";
import { formatError, mediaService } from "#src/helpers/index.js";
import { successResponse, createdResponse } from "#src/serializers/index.js";
import { mediaQueue, MEDIA_JOBS } from "#src/background/queues/index.js";
import { randomUUID } from "crypto";

const router = express.Router({ mergeParams: true });

const createSessionValidators = [
  body("files")
    .isArray({ min: 1, max: 10 })
    .withMessage("Must upload 1-10 files"),
  body("files.*.filename")
    .notEmpty()
    .withMessage("Filename is required")
    .matches(/\.(jpg|jpeg|png|webp)$/i)
    .withMessage("Invalid file extension"),
  body("files.*.content_type")
    .isIn(["image/jpeg", "image/png", "image/webp"])
    .withMessage("Invalid content type"),
  body("files.*.metadata")
    .optional()
    .isObject()
    .withMessage("Metadata must be an object"),
];

const sessionParamValidators = [
  param("sessionId").isUUID().withMessage("Invalid session ID"),
];

const commitSessionValidators = [
  param("sessionId").isUUID().withMessage("Invalid session ID"),
  body("owner_type")
    .isIn(["actor", "input", "account"])
    .withMessage("Invalid owner type"),
  body("owner_id").isUUID().withMessage("Invalid owner ID"),
];

// Create a new upload session with multiple pending uploads
router.post(
  "/",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(20, 3600000), // 20 sessions per hour
  createSessionValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { files } = req.body;
      const uploadSessionId = randomUUID();


      const uploads = await Promise.all(
        files.map(async (file) => {
          const uploadData = await mediaService.getSignedUploadUrl(
            file.content_type
          );

          const media = await Media.createPendingUpload(
            uploadSessionId,
            uploadData.imageKey,
            res.locals.account.id, // Pass account ID as owner_id
            {
              ...(file.metadata || {}),
              content_type: file.content_type,
              filename: file.filename,
              uploaded_by: res.locals.account.id,
              app_id: res.locals.app.id,
            }
          );

          // Auto-simulate upload completion in development by queuing webhook job
          if (process.env.NODE_ENV === 'development') {
            try {
              await mediaQueue.add(MEDIA_JOBS.PROCESS_IMAGE_UPLOAD, {
                mediaId: media.id,
                imageKey: uploadData.imageKey,
                metadata: {
                  file_size: 1024000, // Fake 1MB file
                  dimensions: { width: 800, height: 600 },
                  format: "jpeg",
                  simulated_upload: true,
                },
              }, {
                delay: 1000, // 1 second delay to simulate upload time
              });
              console.log(`🔧 DEV: Queued simulated upload completion job for ${uploadData.imageKey}`);
            } catch (error) {
              console.warn(`Failed to queue simulated upload job:`, error);
            }
          }

          return {
            media_id: media.id,
            image_key: uploadData.imageKey,
            upload_url: uploadData.uploadUrl,
            image_url: uploadData.imageUrl,
            filename: file.filename,
          };
        })
      );

      const data = {
        upload_session_id: uploadSessionId,
        uploads,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        expires_in: 86400, // 24 hours in seconds
      };

      return res
        .status(201)
        .json(createdResponse(data, "Upload session created successfully"));
    } catch (error) {
      console.error("Create upload session error:", error);
      return res
        .status(500)
        .json(formatError("Failed to create upload session"));
    }
  }
);

// Get pending uploads for a session
router.get(
  "/:sessionId",
  requireAppContext,
  requireAuth,
  sessionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      const pendingMedia = await Media.findPendingBySessionId(sessionId);

      if (pendingMedia.length === 0) {
        return res
          .status(404)
          .json(formatError("Upload session not found or expired", 404));
      }

      // Verify ownership through uploaded_by metadata
      const hasAccess = pendingMedia.every(
        (media) => media.metadata?.uploaded_by === res.locals.account.id
      );

      if (!hasAccess) {
        return res
          .status(403)
          .json(formatError("Access denied to upload session", 403));
      }

      const uploads = await Promise.all(
        pendingMedia.map(async (media) => ({
          media_id: media.id,
          image_key: media.image_key,
          image_url: await mediaService.getSignedImageUrl(media.image_key),
          status: media.status,
          filename: media.metadata?.filename,
          metadata: media.metadata,
          expires_at: media.expires_at,
          created_at: media.created_at,
        }))
      );

      const data = {
        upload_session_id: sessionId,
        uploads,
        total_count: uploads.length,
        expires_at: pendingMedia[0]?.expires_at,
      };

      return res
        .status(200)
        .json(successResponse(data, "Upload session retrieved successfully"));
    } catch (error) {
      console.error("Get upload session error:", error);
      return res
        .status(500)
        .json(formatError("Failed to retrieve upload session"));
    }
  }
);

// Commit pending uploads to a specific owner (actor, input, or account)
router.post(
  "/:sessionId/commit",
  requireAppContext,
  requireAuth,
  sessionParamValidators,
  commitSessionValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { owner_type, owner_id } = req.body;

      // Verify the session exists and belongs to this user
      const pendingMedia = await Media.findPendingBySessionId(sessionId);

      if (pendingMedia.length === 0) {
        return res
          .status(404)
          .json(formatError("Upload session not found or expired", 404));
      }

      // Verify ownership
      const hasAccess = pendingMedia.every(
        (media) => media.metadata?.uploaded_by === res.locals.account.id
      );

      if (!hasAccess) {
        return res
          .status(403)
          .json(formatError("Access denied to upload session", 403));
      }

      // Verify the owner exists and belongs to this account
      if (owner_type === "actor") {
        const { Actor } = await import("#src/models/index.js");
        const actor = await Actor.query()
          .findById(owner_id)
          .where("account_id", res.locals.account.id);

        if (!actor) {
          return res
            .status(404)
            .json(formatError("Actor not found or access denied", 404));
        }
      } else if (owner_type === "input") {
        const { Input } = await import("#src/models/index.js");
        const input = await Input.query()
          .findById(owner_id)
          .where("account_id", res.locals.account.id);

        if (!input) {
          return res
            .status(404)
            .json(formatError("Input not found or access denied", 404));
        }
      } else if (
        owner_type === "account" &&
        owner_id !== res.locals.account.id
      ) {
        return res
          .status(403)
          .json(formatError("Cannot commit to different account", 403));
      }

      // Commit the pending media
      const updatedCount = await Media.commitPendingMedia(
        sessionId,
        owner_type,
        owner_id
      );

      const data = {
        committed_count: updatedCount,
        owner_type,
        owner_id,
      };

      return res
        .status(200)
        .json(successResponse(data, "Upload session committed successfully"));
    } catch (error) {
      console.error("Commit upload session error:", error);
      return res
        .status(500)
        .json(formatError("Failed to commit upload session"));
    }
  }
);

// Cancel/delete a pending upload session
router.delete(
  "/:sessionId",
  requireAppContext,
  requireAuth,
  sessionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      // Find pending media for this session
      const pendingMedia = await Media.findPendingBySessionId(sessionId);

      if (pendingMedia.length === 0) {
        return res
          .status(404)
          .json(formatError("Upload session not found or expired", 404));
      }

      // Verify ownership
      const hasAccess = pendingMedia.every(
        (media) => media.metadata?.uploaded_by === res.locals.account.id
      );

      if (!hasAccess) {
        return res
          .status(403)
          .json(formatError("Access denied to upload session", 403));
      }

      // Delete from storage service
      const deletePromises = pendingMedia.map(async (media) => {
        try {
          await mediaService.deleteImage(media.image_key);
        } catch (storageError) {
          console.warn(
            `Failed to delete ${media.image_key} from storage:`,
            storageError
          );
        }
      });

      await Promise.allSettled(deletePromises);

      // Delete from database
      await Media.query()
        .where("upload_session_id", sessionId)
        .where("status", "pending")
        .delete();

      const data = {
        deleted_count: pendingMedia.length,
      };

      return res
        .status(200)
        .json(successResponse(data, "Upload session cancelled successfully"));
    } catch (error) {
      console.error("Cancel upload session error:", error);
      return res
        .status(500)
        .json(formatError("Failed to cancel upload session"));
    }
  }
);

// Add individual file to existing session
router.post(
  "/:sessionId/files",
  requireAppContext,
  requireAuth,
  sessionParamValidators,
  [
    body("filename")
      .notEmpty()
      .withMessage("Filename is required")
      .matches(/\.(jpg|jpeg|png|webp)$/i)
      .withMessage("Invalid file extension"),
    body("content_type")
      .isIn(["image/jpeg", "image/png", "image/webp"])
      .withMessage("Invalid content type"),
    body("metadata")
      .optional()
      .isObject()
      .withMessage("Metadata must be an object"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { filename, content_type, metadata = {} } = req.body;

      // Verify the session exists and hasn't expired
      const existingMedia = await Media.findPendingBySessionId(sessionId);

      if (existingMedia.length === 0) {
        return res
          .status(404)
          .json(formatError("Upload session not found or expired", 404));
      }

      // Verify ownership
      const hasAccess = existingMedia.every(
        (media) => media.metadata?.uploaded_by === res.locals.account.id
      );

      if (!hasAccess) {
        return res
          .status(403)
          .json(formatError("Access denied to upload session", 403));
      }

      // Check session hasn't reached max files (10)
      if (existingMedia.length >= 10) {
        return res
          .status(400)
          .json(
            formatError(
              "Upload session has reached maximum file limit (10)",
              400
            )
          );
      }

      const uploadData = await mediaService.getSignedUploadUrl(
        content_type
      );

      const media = await Media.createPendingUpload(sessionId, uploadData.imageKey, res.locals.account.id, {
        ...metadata,
        content_type,
        filename,
        uploaded_by: res.locals.account.id,
        app_id: res.locals.app.id,
      });

      // Auto-simulate upload completion in development by queuing webhook job
      if (process.env.NODE_ENV === 'development') {
        try {
          await mediaQueue.add(MEDIA_JOBS.PROCESS_IMAGE_UPLOAD, {
            mediaId: media.id,
            imageKey: uploadData.imageKey,
            metadata: {
              file_size: 1024000, // Fake 1MB file
              dimensions: { width: 800, height: 600 },
              format: "jpeg",
              simulated_upload: true,
            },
          }, {
            delay: 1000, // 1 second delay to simulate upload time
          });
          console.log(`🔧 DEV: Queued simulated upload completion job for ${uploadData.imageKey}`);
        } catch (error) {
          console.warn(`Failed to queue simulated upload job:`, error);
        }
      }

      const data = {
        media_id: media.id,
        image_key: uploadData.imageKey,
        upload_url: uploadData.uploadUrl,
        image_url: uploadData.imageUrl,
        filename,
      };

      return res
        .status(201)
        .json(
          createdResponse(data, "File added to upload session successfully")
        );
    } catch (error) {
      console.error("Add file to session error:", error);
      return res
        .status(500)
        .json(formatError("Failed to add file to upload session"));
    }
  }
);

export default router;
