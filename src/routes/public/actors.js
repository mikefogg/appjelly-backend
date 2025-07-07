import express from "express";
import { body, param } from "express-validator";
import {
  requireAppContext,
  requireAuth,
  handleValidationErrors,
  rateLimitByAccount,
} from "#src/middleware/index.js";
import { Actor, Media } from "#src/models/index.js";
import {
  actorListSerializer,
  actorSerializer,
  mediaUploadSerializer,
  successResponse,
  createdResponse,
} from "#src/serializers/index.js";
import { formatError, mediaService } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

const createActorValidators = [
  body("name")
    .isLength({ min: 1, max: 100 })
    .withMessage("Name must be 1-100 characters"),
  body("type")
    .isIn(["child", "pet", "adult", "character", "other"])
    .withMessage("Invalid actor type"),
  body("is_claimable")
    .optional()
    .isBoolean()
    .withMessage("is_claimable must be a boolean"),
  body("metadata")
    .optional()
    .isObject()
    .withMessage("Metadata must be an object"),
  body("upload_session_id")
    .optional()
    .isUUID()
    .withMessage("Invalid upload session ID"),
];

const updateActorValidators = [
  param("id").isUUID().withMessage("Invalid actor ID"),
  body("name")
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage("Name must be 1-100 characters"),
  body("type")
    .optional()
    .isIn(["child", "pet", "adult", "character", "other"])
    .withMessage("Invalid actor type"),
  body("is_claimable")
    .optional()
    .isBoolean()
    .withMessage("is_claimable must be a boolean"),
  body("metadata")
    .optional()
    .isObject()
    .withMessage("Metadata must be an object"),
  body("upload_session_id")
    .optional()
    .isUUID()
    .withMessage("Invalid upload session ID"),
];

router.get("/", requireAppContext, requireAuth, async (req, res) => {
  try {

    let query = Actor.query()
      .where("account_id", res.locals.account.id)
      .where("app_id", res.locals.app.id)
      .withGraphFetched("[media(committed)]")
      .orderBy("created_at", "desc");

    // Filter by type if specified
    if (req.query.type) {
      query = query.where("type", req.query.type);
    }

    const actors = await query;

    console.log("actors", actors);

    const serializedData = await actorListSerializer(actors);
    return res.status(200).json({
      ...serializedData,
      message: "Actors retrieved successfully",
    });
  } catch (error) {
    console.error("Get actors error:", error);
    return res.status(500).json(formatError("Failed to retrieve actors"));
  }
});

router.post(
  "/",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(20, 60000), // 20 actors per minute
  createActorValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { name, type, is_claimable = false, metadata = {}, upload_session_id } = req.body;

      const existingActorsCount = await Actor.query()
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .resultSize();

      const maxActors = res.locals.app.config?.limits?.max_actors || 10;
      if (existingActorsCount >= maxActors) {
        return res
          .status(400)
          .json(formatError(`Maximum of ${maxActors} actors allowed`));
      }

      // If upload_session_id provided, verify it exists and belongs to this user
      let pendingMediaCount = 0;
      if (upload_session_id) {
        const pendingMedia = await Media.findPendingBySessionId(upload_session_id);
        
        if (pendingMedia.length === 0) {
          return res
            .status(404)
            .json(formatError("Upload session not found or expired", 404));
        }

        // Verify ownership
        const hasAccess = pendingMedia.every(media => 
          media.metadata?.uploaded_by === res.locals.account.id
        );

        if (!hasAccess) {
          return res
            .status(403)
            .json(formatError("Access denied to upload session", 403));
        }

        pendingMediaCount = pendingMedia.length;

        // Check media limit (10 images per actor)
        if (pendingMediaCount > 10) {
          return res
            .status(400)
            .json(formatError("Cannot commit more than 10 images to actor"));
        }
      }

      // Create actor and commit pending media in a transaction
      const result = await Actor.transaction(async (trx) => {
        const actor = await Actor.query(trx)
          .insert({
            account_id: res.locals.account.id,
            app_id: res.locals.app.id,
            name,
            type,
            is_claimable,
            metadata,
          });

        // Commit pending media if session provided
        if (upload_session_id) {
          await Media.query(trx)
            .where("upload_session_id", upload_session_id)
            .where("status", "pending")
            .where("expires_at", ">", new Date().toISOString())
            .patch({
              owner_type: "actor",
              owner_id: actor.id,
              status: "committed",
              upload_session_id: null,
              expires_at: null,
            });
        }

        // Return actor with media
        return await Actor.query(trx)
          .findById(actor.id)
          .withGraphFetched("[media(committed)]");
      });

      const data = await actorSerializer(result);
      return res
        .status(201)
        .json(createdResponse(data, "Actor created successfully"));
    } catch (error) {
      console.error("Create actor error:", error);
      return res.status(500).json(formatError("Failed to create actor"));
    }
  }
);

router.get(
  "/:id",
  requireAppContext,
  requireAuth,

  async (req, res) => {
    try {
      const { id } = req.params;

      const actors = await Actor.findAccessibleActors(res.locals.account.id, res.locals.app.id);
      const actor = actors.find((a) => a.id === id);

      if (!actor) {
        return res.status(404).json(formatError("Actor not found", 404));
      }

      const data = await actorSerializer(actor);
      return res
        .status(200)
        .json(successResponse(data, "Actor retrieved successfully"));
    } catch (error) {
      console.error("Get actor error:", error);
      return res.status(500).json(formatError("Failed to retrieve actor"));
    }
  }
);

router.patch(
  "/:id",
  requireAppContext,
  requireAuth,

  updateActorValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { upload_session_id, ...updates } = req.body;

      const actor = await Actor.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[media(committed)]");

      if (!actor) {
        return res
          .status(404)
          .json(formatError("Actor not found or access denied", 404));
      }

      // If upload_session_id provided, verify it exists and belongs to this user
      let pendingMediaCount = 0;
      if (upload_session_id) {
        const pendingMedia = await Media.findPendingBySessionId(upload_session_id);
        
        if (pendingMedia.length === 0) {
          return res
            .status(404)
            .json(formatError("Upload session not found or expired", 404));
        }

        // Verify ownership
        const hasAccess = pendingMedia.every(media => 
          media.metadata?.uploaded_by === res.locals.account.id
        );

        if (!hasAccess) {
          return res
            .status(403)
            .json(formatError("Access denied to upload session", 403));
        }

        pendingMediaCount = pendingMedia.length;
        const currentMediaCount = actor.media ? actor.media.length : 0;

        // Check media limit (10 images per actor)
        if (currentMediaCount + pendingMediaCount > 10) {
          return res
            .status(400)
            .json(formatError(`Cannot add ${pendingMediaCount} images. Actor already has ${currentMediaCount} images (max 10 total)`, 400));
        }
      }

      // Update actor and commit pending media in a transaction
      const result = await Actor.transaction(async (trx) => {
        const updatedActor = await actor.$query(trx).patchAndFetch(updates);

        // Commit pending media if session provided
        if (upload_session_id) {
          await Media.query(trx)
            .where("upload_session_id", upload_session_id)
            .where("status", "pending")
            .where("expires_at", ">", new Date().toISOString())
            .patch({
              owner_type: "actor",
              owner_id: actor.id,
              status: "committed",
              upload_session_id: null,
              expires_at: null,
            });
        }

        // Return actor with media
        return await Actor.query(trx)
          .findById(updatedActor.id)
          .withGraphFetched("[media(committed)]");
      });

      const data = await actorSerializer(result);
      return res
        .status(200)
        .json(successResponse(data, "Actor updated successfully"));
    } catch (error) {
      console.error("Update actor error:", error);
      return res.status(500).json(formatError("Failed to update actor"));
    }
  }
);

router.delete(
  "/:id",
  requireAppContext,
  requireAuth,

  async (req, res) => {
    try {
      const { id } = req.params;

      const actor = await Actor.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!actor) {
        return res
          .status(404)
          .json(formatError("Actor not found or access denied", 404));
      }

      await actor.$query().delete();

      return res
        .status(200)
        .json(successResponse({ success: true }, "Actor deleted successfully"));
    } catch (error) {
      console.error("Delete actor error:", error);
      return res.status(500).json(formatError("Failed to delete actor"));
    }
  }
);

// Upload single image for character
router.post(
  "/:id/media",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(10, 60000), // 10 uploads per minute
  async (req, res) => {
    try {
      const { id } = req.params;
      const { content_type = "image/jpeg", metadata = {} } = req.body;

      const actor = await Actor.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[media(committed)]");

      if (!actor) {
        return res
          .status(404)
          .json(formatError("Actor not found or access denied", 404));
      }

      // Check if actor already has 10 images
      if (actor.media && actor.media.length >= 10) {
        return res
          .status(400)
          .json(formatError("Maximum of 10 images allowed per character"));
      }

      const uploadData = await mediaService.getSignedUploadUrl(
        content_type
      );

      const media = await Media.createForActor(actor.id, uploadData.imageKey, {
        ...metadata,
        upload_url: uploadData.uploadUrl,
        status: "pending",
        content_type,
      });

      const data = mediaUploadSerializer(media, uploadData);

      return res
        .status(201)
        .json(createdResponse(data, "Upload URL generated"));
    } catch (error) {
      console.error("Generate upload URL error:", error);
      return res.status(500).json(formatError("Failed to generate upload URL"));
    }
  }
);

// Batch upload multiple images for character (up to 10)
router.post(
  "/:id/media/batch",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(5, 60000), // 5 batch uploads per minute
  body("files").isArray({ min: 1, max: 10 }).withMessage("Must upload 1-10 files"),
  body("files.*.content_type").optional().isIn(["image/jpeg", "image/png", "image/webp"]).withMessage("Invalid content type"),
  body("files.*.metadata").optional().isObject().withMessage("Metadata must be an object"),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { files } = req.body;

      const actor = await Actor.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[media(committed)]");

      if (!actor) {
        return res
          .status(404)
          .json(formatError("Actor not found or access denied", 404));
      }

      // Check total image count won't exceed 10
      const currentImageCount = actor.media ? actor.media.length : 0;
      const newImageCount = files.length;
      
      if (currentImageCount + newImageCount > 10) {
        return res
          .status(400)
          .json(formatError(`Cannot upload ${newImageCount} images. Character already has ${currentImageCount} images (max 10 total)`));
      }

      // Generate upload URLs for all files
      const uploads = await Promise.all(
        files.map(async (file) => {
          const uploadData = await mediaService.getSignedUploadUrl(
            file.content_type || "image/jpeg"
          );

          const media = await Media.createForActor(actor.id, uploadData.imageKey, {
            ...(file.metadata || {}),
            upload_url: uploadData.uploadUrl,
            status: "pending",
            content_type: file.content_type || "image/jpeg",
            batch_upload: true,
          });

          return {
            media_id: media.id,
            image_key: uploadData.imageKey,
            upload_url: uploadData.uploadUrl,
            image_url: uploadData.imageUrl,
          };
        })
      );

      return res
        .status(201)
        .json(createdResponse({ uploads }, "Batch upload URLs generated"));
    } catch (error) {
      console.error("Generate batch upload URLs error:", error);
      return res.status(500).json(formatError("Failed to generate batch upload URLs"));
    }
  }
);

// Get all images for a character
router.get(
  "/:id/media",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;

      const actor = await Actor.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!actor) {
        return res
          .status(404)
          .json(formatError("Actor not found or access denied", 404));
      }

      const media = await Media.findCommittedByOwner("actor", id);

      const data = media.map(item => ({
        id: item.id,
        image_key: item.image_key,
        image_url: mediaService.getImageUrl(item.image_key),
        thumbnail_url: mediaService.getImageUrl(item.image_key, "thumbnail"),
        status: item.metadata?.status || "completed",
        uploaded_at: item.metadata?.uploaded_at || item.created_at,
        metadata: item.metadata,
      }));

      return res
        .status(200)
        .json(successResponse(data, "Character images retrieved"));
    } catch (error) {
      console.error("Get character media error:", error);
      return res.status(500).json(formatError("Failed to retrieve character images"));
    }
  }
);

router.delete(
  "/:id/media/:mediaId",
  requireAppContext,
  requireAuth,

  async (req, res) => {
    try {
      const { id, mediaId } = req.params;

      const actor = await Actor.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!actor) {
        return res
          .status(404)
          .json(formatError("Actor not found or access denied", 404));
      }

      const media = await Media.query()
        .findById(mediaId)
        .where("owner_type", "actor")
        .where("owner_id", id);

      if (!media) {
        return res.status(404).json(formatError("Media not found"));
      }

      await mediaService.deleteImage(media.image_key);
      await media.$query().delete();

      return res
        .status(200)
        .json(successResponse({ success: true }, "Media deleted successfully"));
    } catch (error) {
      console.error("Delete media error:", error);
      return res.status(500).json(formatError("Failed to delete media"));
    }
  }
);

export default router;
