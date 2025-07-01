import express from "express";
import { body, param } from "express-validator";
import { requireAuth, requireAppContext,  handleValidationErrors, rateLimitByAccount } from "#src/middleware/index.js";
import { Media } from "#src/models/index.js";
import { successResponse, createdResponse, mediaUploadSerializer, mediaSerializer, batchUploadSerializer, mediaDetailSerializer, mediaListSerializer } from "#src/serializers/index.js";
import { formatError, mediaService } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

const uploadValidators = [
  body("filename").notEmpty().withMessage("Filename is required")
    .matches(/\.(jpg|jpeg|png|webp)$/i).withMessage("Invalid file extension"),
  body("content_type").optional().isIn(["image/jpeg", "image/png", "image/webp"]).withMessage("Invalid content type"),
  body("file_size").optional().isInt({ min: 1, max: 10 * 1024 * 1024 }).withMessage("File size must be 1 byte to 10MB"),
  body("metadata").optional().isObject().withMessage("Metadata must be an object"),
];

const batchUploadValidators = [
  body("files").isArray({ min: 1, max: 10 }).withMessage("Must upload 1-10 files"),
  body("files.*.filename").notEmpty().withMessage("Filename is required")
    .matches(/\.(jpg|jpeg|png|webp)$/i).withMessage("Invalid file extension"),
  body("files.*.content_type").isIn(["image/jpeg", "image/png", "image/webp"]).withMessage("Invalid content type"),
  body("files.*.metadata").optional().isObject().withMessage("Metadata must be an object"),
];

const mediaParamValidators = [
  param("id").isUUID().withMessage("Invalid media ID"),
];

router.post(
  "/upload",
  requireAppContext, requireAuth,
  
  rateLimitByAccount(50, 3600000), // 50 uploads per hour
  uploadValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { content_type = "image/jpeg", metadata = {} } = req.body;

      // Generate signed upload URL (Cloudflare will auto-generate imageKey)
      const uploadData = await mediaService.getSignedUploadUrl(content_type);

      // Create media record in pending state
      const media = await Media.query().insert({
        owner_type: "account", // Generic upload not tied to specific actor/input
        owner_id: res.locals.account.id,
        image_key: uploadData.imageKey,
        metadata: {
          ...metadata,
          status: "pending",
          content_type,
          uploaded_by: res.locals.account.id,
        },
      });

      const data = {
        ...mediaUploadSerializer(media, uploadData),
        expires_in: 3600, // 1 hour
      };

      return res.status(201).json(createdResponse(data, "Upload URL generated successfully"));
    } catch (error) {
      console.error("Generate upload URL error:", error);
      return res.status(500).json(formatError("Failed to generate upload URL"));
    }
  }
);

router.post(
  "/batch-upload",
  requireAppContext, requireAuth,
  
  rateLimitByAccount(10, 3600000), // 10 batch uploads per hour
  batchUploadValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { files } = req.body;

      const uploads = await Promise.all(
        files.map(async (file) => {
          const uploadData = await mediaService.getSignedUploadUrl(file.content_type);

          const media = await Media.query().insert({
            owner_type: "account",
            owner_id: res.locals.account.id,
            image_key: uploadData.imageKey,
            metadata: {
              ...(file.metadata || {}),
              status: "pending",
              content_type: file.content_type,
              uploaded_by: res.locals.account.id,
              batch_upload: true,
            },
          });

          return {
            media_id: media.id,
            image_key: uploadData.imageKey,
            upload_url: uploadData.uploadUrl,
            image_url: uploadData.imageUrl,
            filename: file.filename,
          };
        })
      );

      const data = batchUploadSerializer(uploads);

      return res.status(201).json(createdResponse(data, "Batch upload URLs generated successfully"));
    } catch (error) {
      console.error("Generate batch upload URLs error:", error);
      return res.status(500).json(formatError("Failed to generate batch upload URLs"));
    }
  }
);

router.get(
  "/:id",
  requireAppContext, requireAuth,
  
  mediaParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Find media accessible by this account (committed only)
      const media = await Media.query()
        .findById(id)
        .where("status", "committed") // Only show committed media
        .where((builder) => {
          builder
            .where("owner_id", res.locals.account.id)
            .orWhereExists((subquery) => {
              // Media owned by actors accessible to this account
              subquery
                .select("*")
                .from("actors")
                .whereRaw("actors.id = media.owner_id")
                .where("media.owner_type", "actor")
                .where((actorBuilder) => {
                  actorBuilder
                    .where("actors.account_id", res.locals.account.id)
                    .orWhereExists((linkSubquery) => {
                      linkSubquery
                        .select("*")
                        .from("account_links")
                        .whereRaw("account_links.linked_account_id = actors.account_id")
                        .where("account_links.account_id", res.locals.account.id)
                        .where("account_links.status", "accepted");
                    });
                });
            });
        });

      if (!media) {
        return res.status(404).json(formatError("Media not found", 404));
      }

      const data = await mediaDetailSerializer(media, mediaService);

      return res.status(200).json(successResponse(data, "Media details retrieved successfully"));
    } catch (error) {
      console.error("Get media error:", error);
      return res.status(500).json(formatError("Failed to retrieve media details"));
    }
  }
);

router.delete(
  "/:id",
  requireAppContext, requireAuth,
  
  mediaParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Only allow deletion of own committed media or media from owned actors
      const media = await Media.query()
        .findById(id)
        .where("status", "committed") // Only allow deletion of committed media
        .where((builder) => {
          builder
            .where("owner_id", res.locals.account.id)
            .orWhereExists((subquery) => {
              subquery
                .select("*")
                .from("actors")
                .whereRaw("actors.id = media.owner_id")
                .where("media.owner_type", "actor")
                .where("actors.account_id", res.locals.account.id);
            });
        });

      if (!media) {
        return res.status(404).json(formatError("Media not found or access denied", 404));
      }

      // Delete from storage service
      try {
        await mediaService.deleteImage(media.image_key);
      } catch (storageError) {
        console.warn("Failed to delete from storage service:", storageError);
        // Continue with database deletion even if storage deletion fails
      }

      // Delete from database
      await media.$query().delete();

      return res.status(200).json(successResponse(null, "Media deleted successfully"));
    } catch (error) {
      console.error("Delete media error:", error);
      return res.status(500).json(formatError("Failed to delete media"));
    }
  }
);

// List user's media with pagination
router.get(
  "/",
  requireAppContext, requireAuth,
  
  async (req, res) => {
    try {
      const { owner_type, per_page = 20, before } = req.query;

      let query = Media.query()
        .where("status", "committed") // Only show committed media
        .where((builder) => {
          builder
            .where("owner_id", res.locals.account.id)
            .orWhereExists((subquery) => {
              subquery
                .select("*")
                .from("actors")
                .whereRaw("actors.id = media.owner_id")
                .where("media.owner_type", "actor")
                .where("actors.account_id", res.locals.account.id);
            });
        })
        .orderBy("created_at", "desc");

      if (owner_type) {
        query = query.where("owner_type", owner_type);
      }

      if (before) {
        query = query.where("created_at", "<", before);
      }

      const media = await query.limit(parseInt(per_page)).execute();

      const mediaList = media.map(item => ({
        id: item.id,
        owner_type: item.owner_type,
        owner_id: item.owner_id,
        image_key: item.image_key,
        image_url: mediaService.getImageUrl(item.image_key),
        metadata: item.metadata,
        created_at: item.created_at,
      }));

      const data = mediaListSerializer(mediaList, { per_page });

      return res.status(200).json(successResponse(data, "Media retrieved successfully"));
    } catch (error) {
      console.error("List media error:", error);
      return res.status(500).json(formatError("Failed to retrieve media"));
    }
  }
);

// Webhook endpoint for media processing completion (internal use)
router.post(
  "/webhook/processing-complete",
  async (req, res) => {
    try {
      const { image_key, status, metadata = {} } = req.body;

      if (!image_key) {
        return res.status(400).json(formatError("Image key is required"));
      }

      const media = await Media.query().findOne({ image_key });

      if (!media) {
        return res.status(404).json(formatError("Media not found", 404));
      }

      await media.$query().update({
        metadata: {
          ...media.metadata,
          status: status || "completed",
          processed_at: new Date().toISOString(),
          processing_metadata: metadata,
        },
      });

      return res.status(200).json(successResponse(null, "Media processing status updated"));
    } catch (error) {
      console.error("Media processing webhook error:", error);
      return res.status(500).json(formatError("Failed to update media processing status"));
    }
  }
);

export default router;