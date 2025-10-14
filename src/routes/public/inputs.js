import express from "express";
import { body, param } from "express-validator";
import {
  requireAuth,
  requireAppContext,
  handleValidationErrors,
  rateLimitByAccount,
} from "#src/middleware/index.js";
import { Input, Actor, Artifact, Media } from "#src/models/index.js";
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
  inferenceService,
  mediaService,
} from "#src/helpers/index.js";
import {
  createStory,
  queueStoryGeneration,
} from "#src/helpers/story-creation.js";

const router = express.Router({ mergeParams: true });

const createInputValidators = [
  body("prompt")
    .optional()
    .isLength({ min: 1, max: 1000 })
    .withMessage("Prompt must be 1-1000 characters"),
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

router.post(
  "/",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(50, 3600000), // 50 story prompts per hour
  createInputValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        prompt,
        actor_ids,
        main_character_ids = [],
        metadata = {},
        upload_session_id,
      } = req.body;

      // Verify all actors exist and are accessible
      const actors = await Actor.findAccessibleActors(
        res.locals.account.id,
        res.locals.app.id
      );
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
          .json(
            formatError("Main character IDs must be subset of actor IDs", 400)
          );
      }

      // If upload_session_id provided, verify it exists and belongs to this user
      let pendingMediaCount = 0;

      if (upload_session_id) {
        const pendingMedia = await Media.findPendingBySessionId(
          upload_session_id
        );

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

        pendingMediaCount = pendingMedia.length;

        // Check media limit (10 images per input)
        if (pendingMediaCount > 10) {
          return res
            .status(400)
            .json(
              formatError(
                "Cannot commit more than 10 reference images to input"
              )
            );
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
          ...(prompt ? {} : { image_only_input: true }),
        },
        uploadSessionId: upload_session_id,
        appConfig: res.locals.app.config,
      });

      // Queue background story generation using helper
      await queueStoryGeneration({
        inputId: input.id,
        artifactId: artifact.id,
        prompt: input.prompt,
        actorIds: input.actor_ids,
        appConfig: res.locals.app.config,
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

export default router;
