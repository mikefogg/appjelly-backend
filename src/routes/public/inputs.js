import express from "express";
import { body, param } from "express-validator";
import {
  requireAuth,
  requireAppContext,
  handleValidationErrors,
  rateLimitByAccount,
} from "#src/middleware/index.js";
import { Input, Actor, Artifact, ArtifactActor, ArtifactPage, Media } from "#src/models/index.js";
import {
  successResponse,
  createdResponse,
  paginatedResponse,
  inputSerializer,
  inputWithArtifactSerializer,
  inferenceSerializer,
  mediaUploadSerializer,
} from "#src/serializers/index.js";
import {
  formatError,
  aiService,
  inferenceService,
  mediaService,
} from "#src/helpers/index.js";
import { createStory, queueStoryGeneration } from "#src/helpers/story-creation.js";
import {
  contentQueue,
  JOB_GENERATE_STORY,
} from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

const createInputValidators = [
  body("prompt")
    .optional()
    .isLength({ min: 10, max: 1000 })
    .withMessage("Prompt must be 10-1000 characters"),
  body("actor_ids")
    .isArray({ min: 0, max: 5 })
    .withMessage("Must include 0-5 actors"),
  body("actor_ids").custom((value) => {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (
          typeof value[i] !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value[i]
          )
        ) {
          throw new Error("Each actor ID must be a valid UUID");
        }
      }
    }
    return true;
  }),
  body("main_character_ids")
    .optional()
    .isArray({ max: 5 })
    .withMessage("Must include 0-5 main character IDs"),
  body("main_character_ids.*")
    .optional()
    .isUUID()
    .withMessage("Each main character ID must be a valid UUID"),
  body("metadata")
    .optional()
    .isObject()
    .withMessage("Metadata must be an object"),
  body("upload_session_id")
    .optional()
    .isUUID()
    .withMessage("Invalid upload session ID"),
  // Custom validation: require either prompt OR upload_session_id
  body().custom((value) => {
    if (!value.prompt && !value.upload_session_id) {
      throw new Error("Either prompt or upload_session_id is required");
    }
    return true;
  }),
];

const inferenceValidators = [
  param("id").isUUID().withMessage("Invalid input ID"),
];

router.get("/", requireAppContext, requireAuth, async (req, res) => {
  try {
    const pagination = {
      page: parseInt(req.query.page) || 1,
      per_page: Math.min(parseInt(req.query.per_page) || 20, 50),
    };

    const inputs = await Input.findByAccountAndApp(
      res.locals.account.id,
      res.locals.app.id,
      pagination
    );

    // Get total count for pagination
    const totalQuery = Input.query()
      .where("account_id", res.locals.account.id)
      .where("app_id", res.locals.app.id);
    const totalCount = await totalQuery.count().first();

    // Populate actors for each input
    for (const input of inputs) {
      input.actors = await input.getActors();
    }

    const data = await Promise.all(inputs.map((input) => inputSerializer(input)));

    return res.status(200).json(
      paginatedResponse(data, {
        total: parseInt(totalCount.count),
        per_page: pagination.per_page,
        page: pagination.page,
      })
    );
  } catch (error) {
    console.error("Get inputs error:", error);
    return res.status(500).json(formatError("Failed to retrieve inputs"));
  }
});

router.post(
  "/",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(50, 3600000), // 50 story prompts per hour
  createInputValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { prompt, actor_ids, main_character_ids = [], metadata = {}, upload_session_id } = req.body;

      // Verify all actors exist and are accessible
      const actors = await Actor.findAccessibleActors(res.locals.account.id, res.locals.app.id);
      const accessibleActorIds = actors.map((actor) => actor.id);

      const invalidActorIds = actor_ids.filter(
        (id) => !accessibleActorIds.includes(id)
      );
      if (invalidActorIds.length > 0) {
        return res
          .status(400)
          .json(formatError("One or more actors not found", 400));
      }

      // Verify main character IDs are subset of actor IDs
      const invalidMainCharacterIds = main_character_ids.filter(
        (id) => !actor_ids.includes(id)
      );
      if (invalidMainCharacterIds.length > 0) {
        return res
          .status(400)
          .json(formatError("Main character IDs must be subset of actor IDs", 400));
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

        // Check media limit (10 images per input)
        if (pendingMediaCount > 10) {
          return res
            .status(400)
            .json(formatError("Cannot commit more than 10 reference images to input"));
        }
      }

      // Use the reusable story creation helper
      let { input, artifact } = await createStory({
        accountId: res.locals.account.id,
        appId: res.locals.app.id,
        prompt: prompt || null, // Allow null prompt for image-only inputs
        actorIds: actor_ids,
        mainCharacterIds: main_character_ids,
        metadata: {
          ...metadata,
          // Track if this is an image-only input
          ...(prompt ? {} : { image_only_input: true })
        },
        uploadSessionId: upload_session_id,
        appConfig: res.locals.app.config
      });

      // Queue background story generation using helper
      await queueStoryGeneration({
        inputId: input.id,
        artifactId: artifact.id,
        prompt: input.prompt,
        actorIds: input.actor_ids,
        appConfig: res.locals.app.config
      });

      const data = await inputWithArtifactSerializer(input, artifact);

      return res
        .status(201)
        .json(createdResponse(data, "Story prompt created successfully"));
    } catch (error) {
      console.error("Create input error:", error);
      return res.status(500).json(formatError("Failed to create story prompt"));
    }
  }
);

router.get("/:id", requireAppContext, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const input = await Input.query()
      .findById(id)
      .where("account_id", res.locals.account.id)
      .where("app_id", res.locals.app.id)
      .withGraphFetched("[artifacts, media(committed)]");

    if (!input) {
      return res.status(404).json(formatError("Input not found", 404));
    }

    input.actors = await input.getActors();
    const data = await inputSerializer(input);

    return res
      .status(200)
      .json(successResponse(data, "Input details retrieved successfully"));
  } catch (error) {
    console.error("Get input error:", error);
    return res
      .status(500)
      .json(formatError("Failed to retrieve input details"));
  }
});

router.post(
  "/:id/inference",
  requireAppContext,
  requireAuth,
  inferenceValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      const input = await Input.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!input) {
        return res.status(404).json(formatError("Input not found", 404));
      }

      // Get user's actors for matching
      const actors = await Actor.findByAccountAndApp(res.locals.account.id, res.locals.app.id);

      // Use AI-powered inference service
      const inferenceResult =
        await inferenceService.extractCharactersFromPrompt(
          input.prompt,
          res.locals.account.id,
          res.locals.app.id
        );

      const data = inferenceSerializer(inferenceResult, actors, input);

      return res
        .status(200)
        .json(successResponse(data, "Actor suggestions generated"));
    } catch (error) {
      console.error("Inference error:", error);
      return res
        .status(500)
        .json(formatError("Failed to generate actor suggestions"));
    }
  }
);

router.patch(
  "/:id",
  requireAppContext,
  requireAuth,
  [
    param("id").isUUID().withMessage("Invalid input ID"),
    body("prompt")
      .optional()
      .isLength({ min: 10, max: 1000 })
      .withMessage("Prompt must be 10-1000 characters"),
    body("actor_ids")
      .optional()
      .isArray({ min: 0, max: 5 })
      .withMessage("Must include 0-5 actors"),
    body("actor_ids.*")
      .optional()
      .isUUID()
      .withMessage("Each actor ID must be valid"),
    body("metadata")
      .optional()
      .isObject()
      .withMessage("Metadata must be an object"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      const input = await Input.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!input) {
        return res.status(404).json(formatError("Input not found", 404));
      }

      const updates = {};
      if (req.body.prompt !== undefined) updates.prompt = req.body.prompt;
      if (req.body.actor_ids !== undefined)
        updates.actor_ids = req.body.actor_ids;
      if (req.body.metadata !== undefined)
        updates.metadata = { ...input.metadata, ...req.body.metadata };

      const updatedInput = await input.$query().patchAndFetch(updates);

      const data = await inputSerializer(updatedInput);

      return res
        .status(200)
        .json(successResponse(data, "Input updated successfully"));
    } catch (error) {
      console.error("Update input error:", error);
      return res.status(500).json(formatError("Failed to update input"));
    }
  }
);

router.delete(
  "/:id",
  requireAppContext,
  requireAuth,
  [param("id").isUUID().withMessage("Invalid input ID")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      const input = await Input.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!input) {
        return res.status(404).json(formatError("Input not found", 404));
      }

      // Delete related artifacts first
      await Artifact.query().where("input_id", id).delete();

      // Delete the input
      await input.$query().delete();

      return res
        .status(200)
        .json(successResponse(null, "Input deleted successfully"));
    } catch (error) {
      console.error("Delete input error:", error);
      return res.status(500).json(formatError("Failed to delete input"));
    }
  }
);

// Upload single reference image for input/prompt
router.post(
  "/:id/media",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(10, 60000), // 10 uploads per minute
  async (req, res) => {
    try {
      const { id } = req.params;
      const { content_type = "image/jpeg", metadata = {} } = req.body;

      const input = await Input.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[media(committed)]")

      if (!input) {
        return res
          .status(404)
          .json(formatError("Input not found or access denied", 404));
      }

      // Check if input already has 10 images
      if (input.media && input.media.length >= 10) {
        return res
          .status(400)
          .json(formatError("Maximum of 10 reference images allowed per prompt"));
      }

      const uploadData = await mediaService.getSignedUploadUrl(
        content_type
      );

      const media = await Media.createForInput(input.id, uploadData.imageKey, {
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

// Batch upload multiple reference images for input/prompt (up to 10)
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

      const input = await Input.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[media(committed)]")

      if (!input) {
        return res
          .status(404)
          .json(formatError("Input not found or access denied", 404));
      }

      // Check total image count won't exceed 10
      const currentImageCount = input.media ? input.media.length : 0;
      const newImageCount = files.length;
      
      if (currentImageCount + newImageCount > 10) {
        return res
          .status(400)
          .json(formatError(`Cannot upload ${newImageCount} images. Prompt already has ${currentImageCount} images (max 10 total)`));
      }

      // Generate upload URLs for all files
      const uploads = await Promise.all(
        files.map(async (file) => {
          const uploadData = await mediaService.getSignedUploadUrl(
            file.content_type || "image/jpeg"
          );

          const media = await Media.createForInput(input.id, uploadData.imageKey, {
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

// Get all reference images for an input/prompt
router.get(
  "/:id/media",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;

      const input = await Input.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!input) {
        return res
          .status(404)
          .json(formatError("Input not found or access denied", 404));
      }

      const media = await Media.findCommittedByOwner("input", id);

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
        .json(successResponse(data, "Input reference images retrieved"));
    } catch (error) {
      console.error("Get input media error:", error);
      return res.status(500).json(formatError("Failed to retrieve input reference images"));
    }
  }
);

// Delete a reference image from an input/prompt
router.delete(
  "/:id/media/:mediaId",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { id, mediaId } = req.params;

      const input = await Input.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!input) {
        return res
          .status(404)
          .json(formatError("Input not found or access denied", 404));
      }

      const media = await Media.query()
        .findById(mediaId)
        .where("owner_type", "input")
        .where("owner_id", id);

      if (!media) {
        return res.status(404).json(formatError("Media not found"));
      }

      await mediaService.deleteImage(media.image_key);
      await media.$query().delete();

      return res
        .status(200)
        .json(successResponse(null, "Media deleted successfully"));
    } catch (error) {
      console.error("Delete media error:", error);
      return res.status(500).json(formatError("Failed to delete media"));
    }
  }
);

export default router;
