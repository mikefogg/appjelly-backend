import express from "express";
import { body, param } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors, rateLimitByAccount } from "#src/middleware/index.js";
import { SharedView, Artifact, Actor, ArtifactActor, AccountLink } from "#src/models/index.js";
import { sharedArtifactSerializer, successResponse, createdResponse, sharedViewSerializer, claimCharacterSerializer, publicActorSerializer } from "#src/serializers/index.js";
import { formatError, sharingService } from "#src/helpers/index.js";
import { createStory, queueStoryGeneration } from "#src/helpers/story-creation.js";
import { contentQueue, JOB_PROCESS_CHARACTER_CLAIM, JOB_GENERATE_STORY } from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

const createSharedViewValidators = [
  body("artifact_id").isUUID().withMessage("Valid artifact ID is required"),
  body("permissions").optional().isObject().withMessage("Permissions must be an object"),
  body("expires_in_hours").optional().isInt({ min: 1, max: 8760 }).withMessage("Expiration must be 1-8760 hours"), // Max 1 year
  body("metadata").optional().isObject().withMessage("Metadata must be an object"),
];

const tokenParamValidators = [
  param("token").isLength({ min: 32, max: 128 }).withMessage("Invalid token format"),
];

const claimValidators = [
  param("token").isLength({ min: 32, max: 128 }).withMessage("Invalid token format"),
  body("actor_replacements").isObject().withMessage("Actor replacements must be an object"),
];

const claimActorValidators = [
  param("token").isLength({ min: 32, max: 128 }).withMessage("Invalid token format"),
  body("actor_id").isUUID().withMessage("Valid actor ID is required"),
];

router.post(
  "/",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(20, 3600000), // 20 shares per hour
  createSharedViewValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { artifact_id, permissions = {}, expires_in_hours, metadata = {} } = req.body;

      // Verify artifact ownership
      const artifact = await Artifact.query()
        .findById(artifact_id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!artifact) {
        return res.status(404).json(formatError("Artifact not found or access denied", 404));
      }

      // Set expiration if provided
      let finalMetadata = { ...metadata };
      if (expires_in_hours) {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + expires_in_hours);
        finalMetadata.expires_at = expiresAt.toISOString();
      }

      // Use sharing service to create shareable link with QR code support
      const shareOptions = {
        permissions: {
          can_view: true,
          can_repersonalize: permissions.can_repersonalize !== false,
          can_claim_characters: permissions.can_claim_characters !== false,
          can_download: permissions.can_download || false,
        },
        metadata: finalMetadata,
        includeQR: req.body.include_qr || false,
        message: req.body.share_message
      };

      const shareResult = await sharingService.createShareableLink(
        artifact_id,
        res.locals.account.id,
        shareOptions
      );

      const data = {
        token: shareResult.token,
        artifact_id: artifact_id,
        share_url: shareResult.url,
        short_url: shareResult.short_url,
        qr_code: shareResult.qr_code,
        qr_code_svg: shareResult.qr_code_svg,
        message: shareResult.message,
        expires_at: shareResult.expires_at,
        permissions: shareOptions.permissions,
      };

      return res.status(201).json(createdResponse(data, "Shared view created successfully"));
    } catch (error) {
      console.error("Create shared view error:", error);
      return res.status(500).json(formatError("Failed to create shared view"));
    }
  }
);

router.get(
  "/:token",
  requireAppContext,
  tokenParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token } = req.params;

      const sharedView = await SharedView.findByToken(token);

      if (!sharedView) {
        return res.status(404).json(formatError("Shared content not found", 404));
      }

      // Check app isolation
      if (sharedView.artifact.app_id !== res.locals.app.id) {
        return res.status(404).json(formatError("Shared content not found", 404));
      }

      if (sharedView.isExpired()) {
        return res.status(410).json(formatError("Shared content has expired"));
      }

      const data = await sharedArtifactSerializer(sharedView);
      return res.status(200).json(successResponse(data, "Shared content retrieved successfully"));
    } catch (error) {
      console.error("Get shared view error:", error);
      return res.status(500).json(formatError("Failed to retrieve shared content"));
    }
  }
);

router.post(
  "/:token/claim",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(10, 3600000), // 10 claims per hour
  claimValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token } = req.params;
      const { actor_replacements } = req.body;

      const sharedView = await SharedView.findByToken(token);

      if (!sharedView) {
        return res.status(404).json(formatError("Shared content not found", 404));
      }

      // Check app isolation - user must be in the same app as the shared content
      if (sharedView.artifact.app_id !== res.locals.app.id) {
        return res.status(404).json(formatError("Shared content not found", 404));
      }

      if (sharedView.isExpired()) {
        return res.status(410).json(formatError("Shared content has expired"));
      }

      if (!sharedView.hasPermission("can_repersonalize")) {
        return res.status(403).json(formatError("Repersonalization not allowed for this share", 403));
      }

      // Verify replacement actors belong to the user
      const userActors = await Actor.findByAccountAndApp(res.locals.account.id, res.locals.app.id);
      const userActorIds = userActors.map(actor => actor.id);
      
      const replacementActorIds = Object.values(actor_replacements);
      const invalidReplacements = replacementActorIds.filter(id => !userActorIds.includes(id));
      
      if (invalidReplacements.length > 0) {
        return res.status(400).json(formatError("Some replacement actors are not accessible"));
      }

      // Create new input and artifact with replaced actors
      const originalArtifact = sharedView.artifact;
      const originalInput = originalArtifact.input;

      // Map original actor IDs to replacement IDs
      const newActorIds = originalInput.actor_ids.map(originalId => {
        return actor_replacements[originalId] || originalId;
      });

      // Create new input
      const { Input } = await import("#src/models/index.js");
      const newInput = await Input.query().insert({
        account_id: res.locals.account.id,
        app_id: res.locals.app.id,
        prompt: originalInput.prompt,
        actor_ids: newActorIds,
        metadata: {
          ...originalInput.metadata,
          cloned_from: originalInput.id,
          shared_view_token: token,
          actor_replacements,
        },
      });

      // Create new artifact
      const newArtifact = await Artifact.query().insert({
        input_id: newInput.id,
        account_id: res.locals.account.id,
        app_id: res.locals.app.id,
        artifact_type: originalArtifact.artifact_type,
        title: `${originalArtifact.title} (Personalized)`,
        metadata: {
          status: "generating",
          cloned_from: originalArtifact.id,
          shared_view_token: token,
          started_at: new Date().toISOString(),
        },
      });

      // Queue background job for AI generation with new actors
      await contentQueue.add(JOB_PROCESS_CHARACTER_CLAIM, {
        artifactId: newArtifact.id,
        inputId: newInput.id,
        accountId: res.locals.account.id,
        appId: res.locals.app.id,
        claimedFromToken: token,
        actorReplacements: actor_replacements,
        priority: 'high' // Prioritize user-initiated claims
      }, {
        priority: 10, // High priority in queue
        delay: 1000, // Small delay to ensure DB writes are committed
      });

      const data = {
        new_input_id: newInput.id,
        new_artifact_id: newArtifact.id,
        status: "generating",
        message: "Personalized version is being generated",
        estimated_completion: "2-3 minutes",
      };

      return res.status(201).json(createdResponse(data, "Personalized copy created successfully"));
    } catch (error) {
      console.error("Claim shared view error:", error);
      return res.status(500).json(formatError("Failed to create personalized copy"));
    }
  }
);

router.get(
  "/:token/actors",
  tokenParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token } = req.params;

      const sharedView = await SharedView.findByToken(token);

      if (!sharedView) {
        return res.status(404).json(formatError("Shared content not found", 404));
      }

      if (sharedView.isExpired()) {
        return res.status(410).json(formatError("Shared content has expired"));
      }

      const artifact = sharedView.artifact;
      const actors = await artifact.getActorsFromInput();

      const data = actors.map(actor => publicActorSerializer(actor));

      return res.status(200).json(successResponse(data, "Shared story actors retrieved successfully"));
    } catch (error) {
      console.error("Get shared actors error:", error);
      return res.status(500).json(formatError("Failed to retrieve shared story actors"));
    }
  }
);

// New actor claiming endpoint
router.post(
  "/:token/claim-actor",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(5, 3600000), // 5 actor claims per hour
  claimActorValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token } = req.params;
      const { actor_id } = req.body;

      const sharedView = await SharedView.findByToken(token);

      if (!sharedView) {
        return res.status(404).json(formatError("Shared content not found", 404));
      }

      // Check app isolation
      if (sharedView.artifact.app_id !== res.locals.app.id) {
        return res.status(404).json(formatError("Shared content not found", 404));
      }

      if (sharedView.isExpired()) {
        return res.status(410).json(formatError("Shared content has expired"));
      }

      if (!sharedView.hasPermission("can_claim_characters")) {
        return res.status(403).json(formatError("Character claiming not allowed for this share", 403));
      }

      // Verify the actor exists and is claimable
      const actor = await Actor.query()
        .findById(actor_id)
        .where("is_claimable", true)
        .where("app_id", res.locals.app.id);

      if (!actor) {
        return res.status(404).json(formatError("Actor not found or not claimable", 404));
      }

      // Verify the actor is in this artifact (any role)
      const artifactActor = await ArtifactActor.query()
        .where("artifact_id", sharedView.artifact.id)
        .where("actor_id", actor_id)
        .first();

      if (!artifactActor) {
        return res.status(400).json(formatError("Actor is not in this story", 400));
      }

      // Check if user is trying to claim their own actor
      if (actor.account_id === res.locals.account.id) {
        return res.status(400).json(formatError("Cannot claim your own actor", 400));
      }

      // Perform the claim in a transaction
      const result = await Actor.transaction(async (trx) => {
        // Transfer ownership of the actor
        await Actor.query(trx)
          .patch({
            account_id: res.locals.account.id,
            is_claimable: false, // No longer claimable once claimed
            metadata: {
              ...actor.metadata,
              claimed_at: new Date().toISOString(),
              claimed_from_token: token,
              previous_owner_id: actor.account_id,
            }
          })
          .where("id", actor_id);

        // Fetch the updated actor
        const claimedActor = await Actor.query(trx).findById(actor_id);

        // Create family link between the two accounts if it doesn't exist
        const originalOwnerId = actor.account_id;
        const newOwnerId = res.locals.account.id;

        // Check if link already exists (in either direction)
        const existingLink = await AccountLink.query(trx)
          .where((builder) => {
            builder
              .where({
                account_id: originalOwnerId,
                linked_account_id: newOwnerId,
                app_id: res.locals.app.id
              })
              .orWhere({
                account_id: newOwnerId,
                linked_account_id: originalOwnerId,
                app_id: res.locals.app.id
              });
          })
          .first();

        if (!existingLink) {
          // Create bidirectional family links
          await AccountLink.query(trx).insert([
            {
              account_id: originalOwnerId,
              linked_account_id: newOwnerId,
              app_id: res.locals.app.id,
              status: "accepted", // Auto-accept when created through claiming
              created_by_id: newOwnerId, // Claimer initiated the connection
              metadata: {
                created_through_claiming: true,
                actor_id: actor_id,
                share_token: token,
                auto_accepted: true,
              }
            },
            {
              account_id: newOwnerId,
              linked_account_id: originalOwnerId,
              app_id: res.locals.app.id,
              status: "accepted", // Auto-accept when created through claiming
              created_by_id: newOwnerId, // Claimer initiated the connection
              metadata: {
                created_through_claiming: true,
                actor_id: actor_id,
                share_token: token,
                auto_accepted: true,
              }
            }
          ]);
        }

        return claimedActor;
      });

      const data = {
        actor: {
          id: result.id,
          name: result.name,
          type: result.type,
          claimed_at: result.metadata.claimed_at,
        },
        message: `${result.name} has been claimed and added to your family!`,
        family_linked: true,
      };

      return res.status(200).json(successResponse(data, "Actor claimed successfully"));
    } catch (error) {
      console.error("Claim actor error:", error);
      return res.status(500).json(formatError("Failed to claim actor"));
    }
  }
);

// Combined claim and personalize endpoint
const claimAndPersonalizeValidators = [
  param("token").isLength({ min: 32, max: 128 }).withMessage("Invalid token format"),
  body("claim_actor_ids").isArray({ min: 1, max: 10 }).withMessage("Must claim 1-10 actors"),
  body("claim_actor_ids.*").isUUID().withMessage("All actor IDs must be valid UUIDs"),
];

router.post(
  "/:token/claim-and-personalize",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(5, 3600000), // 5 claim-and-personalize per hour
  claimAndPersonalizeValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { token } = req.params;
      const { claim_actor_ids } = req.body;

      const sharedView = await SharedView.findByToken(token);

      if (!sharedView) {
        return res.status(404).json(formatError("Shared content not found", 404));
      }

      // Check app isolation
      if (sharedView.artifact.app_id !== res.locals.app.id) {
        return res.status(404).json(formatError("Shared content not found", 404));
      }

      if (sharedView.isExpired()) {
        return res.status(410).json(formatError("Shared content has expired"));
      }

      if (!sharedView.hasPermission("can_claim_characters")) {
        return res.status(403).json(formatError("Character claiming not allowed for this share", 403));
      }

      // Verify all actors to claim exist, are claimable, and are in the story
      const { ArtifactActor } = await import("#src/models/index.js");
      
      const artifactActors = await ArtifactActor.query()
        .where("artifact_id", sharedView.artifact.id)
        .whereIn("actor_id", claim_actor_ids)
        .withGraphFetched("[actor]");

      if (artifactActors.length !== claim_actor_ids.length) {
        return res.status(400).json(formatError("Some actors are not in this story", 400));
      }

      // Verify all actors are claimable and not owned by current user
      const invalidActors = artifactActors.filter(aa => 
        !aa.actor.is_claimable || aa.actor.account_id === res.locals.account.id
      );

      if (invalidActors.length > 0) {
        return res.status(400).json(formatError("Some actors cannot be claimed", 400));
      }

      // Get all actors in the original story
      const allArtifactActors = await ArtifactActor.query()
        .where("artifact_id", sharedView.artifact.id)
        .withGraphFetched("[actor]");

      // Get user's actors for replacement
      const userActors = await Actor.findByAccountAndApp(res.locals.account.id, res.locals.app.id);
      
      if (userActors.length === 0) {
        return res.status(400).json(formatError("You need to create actors before personalizing stories", 400));
      }

      // Perform the operation in a transaction
      const result = await Actor.transaction(async (trx) => {
        // Step 1: Claim all specified actors
        const claimedActors = [];
        const familyLinksToCreate = [];

        for (const artifactActor of artifactActors) {
          const actor = artifactActor.actor;
          const originalOwnerId = actor.account_id;

          // Transfer ownership
          await Actor.query(trx)
            .patch({
              account_id: res.locals.account.id,
              is_claimable: false,
              metadata: {
                ...actor.metadata,
                claimed_at: new Date().toISOString(),
                claimed_from_token: token,
                previous_owner_id: originalOwnerId,
              }
            })
            .where("id", actor.id);

          const claimedActor = await Actor.query(trx).findById(actor.id);
          claimedActors.push(claimedActor);

          // Prepare family links (avoid duplicates)
          const linkKey = [originalOwnerId, res.locals.account.id].sort().join('-');
          if (!familyLinksToCreate.includes(linkKey)) {
            familyLinksToCreate.push({
              originalOwnerId,
              newOwnerId: res.locals.account.id,
              actorId: actor.id
            });
          }
        }

        // Create family links for unique owner pairs
        for (const linkInfo of familyLinksToCreate) {
          // Check if link already exists
          const existingLink = await AccountLink.query(trx)
            .where((builder) => {
              builder
                .where({
                  account_id: linkInfo.originalOwnerId,
                  linked_account_id: linkInfo.newOwnerId,
                  app_id: res.locals.app.id
                })
                .orWhere({
                  account_id: linkInfo.newOwnerId,
                  linked_account_id: linkInfo.originalOwnerId,
                  app_id: res.locals.app.id
                });
            })
            .first();

          if (!existingLink) {
            await AccountLink.query(trx).insert([
              {
                account_id: linkInfo.originalOwnerId,
                linked_account_id: linkInfo.newOwnerId,
                app_id: res.locals.app.id,
                status: "accepted",
                created_by_id: linkInfo.newOwnerId,
                metadata: {
                  created_through_claiming: true,
                  actor_id: linkInfo.actorId,
                  share_token: token,
                  auto_accepted: true,
                }
              },
              {
                account_id: linkInfo.newOwnerId,
                linked_account_id: linkInfo.originalOwnerId,
                app_id: res.locals.app.id,
                status: "accepted",
                created_by_id: linkInfo.newOwnerId,
                metadata: {
                  created_through_claiming: true,
                  actor_id: linkInfo.actorId,
                  share_token: token,
                  auto_accepted: true,
                }
              }
            ]);
          }
        }

        // Step 2: Create personalized story using reusable helper
        const originalArtifact = sharedView.artifact;
        const originalInput = originalArtifact.input;

        // Build new actor mapping:
        // - Claimed actors: use as-is (now owned by user)
        // - User's existing actors: prioritize as main characters
        const claimedActorIds = claimedActors.map(a => a.id);
        
        // Claimed actors become part of the new story
        const newStoryActorIds = [...claimedActorIds];
        
        // Add user's other actors as main characters (up to 3 total)
        const userOtherActors = userActors.filter(a => !claimedActorIds.includes(a.id));
        const maxAdditionalActors = Math.max(0, 3 - claimedActorIds.length);
        const additionalActors = userOtherActors.slice(0, maxAdditionalActors);
        newStoryActorIds.push(...additionalActors.map(a => a.id));

        // All user actors (claimed + existing) are main characters
        const mainCharacterIds = newStoryActorIds;

        // Use the reusable story creation helper
        const { input: newInput, artifact: newArtifact } = await createStory({
          accountId: res.locals.account.id,
          appId: res.locals.app.id,
          prompt: originalInput.prompt,
          actorIds: newStoryActorIds,
          mainCharacterIds,
          metadata: {
            ...originalInput.metadata,
            personalized_from: originalInput.id,
            shared_view_token: token,
            claimed_actors: claimedActorIds,
            created_via: "claim_and_personalize"
          },
          title: `${originalArtifact.title} (Your Version)`,
          appConfig: res.locals.app.config,
          trx // Pass the transaction
        });

        return { newInput, newArtifact, claimedActors };
      });

      // Queue background job for AI generation using helper
      await queueStoryGeneration({
        inputId: result.newInput.id,
        artifactId: result.newArtifact.id,
        prompt: result.newInput.prompt,
        actorIds: result.newInput.actor_ids,
        appConfig: res.locals.app.config,
        priority: 'high' // User-initiated, prioritize
      });

      // Prepare response data (similar to story creation)
      const responseData = {
        // Claimed actors info
        claimed_actors: result.claimedActors.map(actor => ({
          id: actor.id,
          name: actor.name,
          type: actor.type,
          claimed_at: actor.metadata.claimed_at,
        })),
        
        // New story info
        new_story: {
          input_id: result.newInput.id,
          artifact_id: result.newArtifact.id,
          title: result.newArtifact.title,
          status: "generating",
          estimated_completion: "2-3 minutes",
          actor_count: result.newInput.actor_ids.length,
          main_characters: result.newInput.actor_ids.length, // All are main characters
        },

        // Summary
        message: `Claimed ${result.claimedActors.length} characters and started generating your personalized story!`,
        families_linked: true,
      };

      return res.status(201).json(createdResponse(responseData, "Characters claimed and story generation started"));

    } catch (error) {
      console.error("Claim and personalize error:", error);
      return res.status(500).json(formatError("Failed to claim characters and personalize story"));
    }
  }
);

export default router;