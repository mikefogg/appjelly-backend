import express from "express";
import { body, param } from "express-validator";
import {
  requireAuth,
  requireAppContext,
  handleValidationErrors,
  rateLimitByAccount,
} from "#src/middleware/index.js";
import { Media } from "#src/models/index.js";
import {
  createdResponse,
  mediaUploadSerializer,
  batchUploadSerializer,
} from "#src/serializers/index.js";
import { formatError, mediaService } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

const uploadValidators = [
  body("filename")
    .notEmpty()
    .withMessage("Filename is required")
    .matches(/\.(jpg|jpeg|png|webp)$/i)
    .withMessage("Invalid file extension"),
  body("content_type")
    .optional()
    .isIn(["image/jpeg", "image/png", "image/webp"])
    .withMessage("Invalid content type"),
  body("file_size")
    .optional()
    .isInt({ min: 1, max: 10 * 1024 * 1024 })
    .withMessage("File size must be 1 byte to 10MB"),
  body("metadata")
    .optional()
    .isObject()
    .withMessage("Metadata must be an object"),
];

const batchUploadValidators = [
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

const mediaParamValidators = [
  param("id").isUUID().withMessage("Invalid media ID"),
];

router.post(
  "/upload",
  requireAppContext,
  requireAuth,
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

      return res
        .status(201)
        .json(createdResponse(data, "Upload URL generated successfully"));
    } catch (error) {
      console.error("Generate upload URL error:", error);
      return res.status(500).json(formatError("Failed to generate upload URL"));
    }
  }
);

router.post(
  "/batch-upload",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(10, 3600000), // 10 batch uploads per hour
  batchUploadValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { files } = req.body;

      const uploads = await Promise.all(
        files.map(async (file) => {
          const uploadData = await mediaService.getSignedUploadUrl(
            file.content_type
          );

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

      return res
        .status(201)
        .json(
          createdResponse(data, "Batch upload URLs generated successfully")
        );
    } catch (error) {
      console.error("Generate batch upload URLs error:", error);
      return res
        .status(500)
        .json(formatError("Failed to generate batch upload URLs"));
    }
  }
);

export default router;
