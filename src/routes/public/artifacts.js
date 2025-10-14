import express from "express";
import { param, body } from "express-validator";
import { requireAuth, requireAppContext,  handleValidationErrors, rateLimitByAccount } from "#src/middleware/index.js";
import { Artifact, ArtifactPage, Input, Actor } from "#src/models/index.js";
import { artifactSerializer, artifactWithPagesSerializer, pageSerializer, pageWithArtifactSerializer, successResponse, paginatedResponse } from "#src/serializers/index.js";
import { formatError, aiService } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

const artifactParamValidators = [
  param("id").isUUID().withMessage("Invalid artifact ID"),
];

router.get(
  "/",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const pagination = {
        page: parseInt(req.query.page) || 1,
        per_page: Math.min(parseInt(req.query.per_page) || 20, 50),
      };

      const includeShared = req.query.include_shared === "true";
      const artifactType = req.query.type;
      const filter = req.query.filter; // 'owned', 'shared', or null for all

      let artifacts;
      let totalQuery;

      if (filter === 'owned') {
        // Only stories where user's account is the owner
        artifacts = await Artifact.findByAccountAndApp(res.locals.account.id, res.locals.app.id, pagination);
        totalQuery = Artifact.query()
          .where('account_id', res.locals.account.id)
          .where('app_id', res.locals.app.id);
      } else if (filter === 'shared') {
        // Only stories from linked families where user's child appears
        artifacts = await Artifact.findSharedWithAccount(res.locals.account.id, res.locals.app.id, pagination);
        totalQuery = Artifact.query()
          .joinRelated('account.account_links')
          .where('account_links.linked_account_id', res.locals.account.id)
          .where('account_links.status', 'accepted')
          .where('artifacts.app_id', res.locals.app.id)
          .distinct('artifacts.id');
      } else if (includeShared) {
        // All accessible stories (owned + shared)
        artifacts = await Artifact.findAccessibleArtifacts(res.locals.account.id, res.locals.app.id, pagination);
        totalQuery = Artifact.query()
          .where(builder => {
            builder.where('account_id', res.locals.account.id)
              .orWhereExists(subquery => {
                subquery.from('account_links')
                  .whereColumn('account_links.account_id', 'artifacts.account_id')
                  .where('account_links.linked_account_id', res.locals.account.id)
                  .where('account_links.status', 'accepted');
              });
          })
          .where('app_id', res.locals.app.id);
      } else {
        // Default: only owned stories
        artifacts = await Artifact.findByAccountAndApp(res.locals.account.id, res.locals.app.id, pagination);
        totalQuery = Artifact.query()
          .where('account_id', res.locals.account.id)
          .where('app_id', res.locals.app.id);
      }

      // Apply type filter if provided
      if (artifactType) {
        artifacts = artifacts.filter(artifact => artifact.artifact_type === artifactType);
        totalQuery = totalQuery.where('artifact_type', artifactType);
      }
      
      const totalCount = await totalQuery.resultSize();

      const data = await Promise.all(artifacts.map(async artifact => await artifactSerializer(artifact)));

      return res.status(200).json(paginatedResponse(data, { 
        ...pagination, 
        total: totalCount,
        has_more: artifacts.length === pagination.per_page 
      }));
    } catch (error) {
      console.error("Get artifacts error:", error);
      return res.status(500).json(formatError("Failed to retrieve artifacts"));
    }
  }
);

router.get(
  "/:id",
  requireAppContext,
  requireAuth,
  artifactParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Check if artifact is accessible (owned or shared)
      const accessibleArtifacts = await Artifact.findAccessibleArtifacts(res.locals.account.id, res.locals.app.id);
      const artifact = accessibleArtifacts.find(a => a.id === id);
      
      if (artifact && artifact.input && artifact.input.actor_ids?.length > 0) {
        // Load actors for the input manually
        const { Actor } = await import("#src/models/index.js");
        const actors = await Actor.query().whereIn('id', artifact.input.actor_ids);
        artifact.input.actors = actors;
      }

      if (!artifact) {
        return res.status(404).json(formatError("Artifact not found", 404));
      }

      const data = await artifactSerializer(artifact);

      console.log("🔍 Artifact data:", JSON.stringify(data, null, 2));
      return res.status(200).json(successResponse(data, "Artifact retrieved successfully"));
    } catch (error) {
      console.error("Get artifact error:", error);
      return res.status(500).json(formatError("Failed to retrieve artifact"));
    }
  }
);

router.get(
  "/:id/pages",
  requireAppContext,
  requireAuth,
  artifactParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Check if artifact is accessible
      const accessibleArtifacts = await Artifact.findAccessibleArtifacts(res.locals.account.id, res.locals.app.id);
      const artifact = accessibleArtifacts.find(a => a.id === id);

      if (!artifact) {
        return res.status(404).json(formatError("Artifact not found", 404));
      }

      const pages = await ArtifactPage.findByArtifact(id);

      const data = await Promise.all(pages.map(page => pageSerializer(page)));

      return res.status(200).json(successResponse(data, "Artifact pages retrieved successfully"));
    } catch (error) {
      console.error("Get artifact pages error:", error);
      return res.status(500).json(formatError("Failed to retrieve artifact pages"));
    }
  }
);

router.delete(
  "/:id",
  requireAppContext,
  requireAuth,
  artifactParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      const artifact = await Artifact.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!artifact) {
        return res.status(404).json(formatError("Artifact not found or access denied", 404));
      }

      await artifact.$query().delete();

      return res.status(200).json(successResponse(null, "Artifact deleted successfully"));
    } catch (error) {
      console.error("Delete artifact error:", error);
      return res.status(500).json(formatError("Failed to delete artifact"));
    }
  }
);

export default router;