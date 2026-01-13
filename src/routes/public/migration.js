import express from "express";
import { body } from "express-validator";
import {
  requireAppContext,
  requireAuth,
  handleValidationErrors,
} from "#src/middleware/index.js";
import { successResponse } from "#src/serializers/index.js";
import { formatError } from "#src/helpers/index.js";
import { knex } from "#src/models/index.js";
import {
  ghostQueue,
  subscriptionQueue,
  JOB_MIGRATE_CW_CAPTIONS,
  JOB_SYNC_SUBSCRIPTION_STATUS,
} from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

const migrateCaptionWriterValidators = [
  body("uuid")
    .optional()
    .isString()
    .withMessage("uuid must be a string"),
  body("cw_anonymous_id")
    .optional()
    .isString()
    .withMessage("cw_anonymous_id must be a string"),
  body("legacy_post_id")
    .optional()
    .isString()
    .withMessage("legacy_post_id must be a string"),
  body("rc_customer_id")
    .optional()
    .isString()
    .withMessage("rc_customer_id must be a string"),
];

/**
 * POST /migration/caption-writer
 *
 * Attempts to find and migrate a CaptionWriter account to the authenticated Ghost account.
 * Tries identifiers in order of reliability:
 * 1. user_id - direct match on old user table
 * 2. email - match on email
 * 3. legacy_post_id - reverse lookup from a synced post (cw_captions.local_id)
 *
 * Note: uuid and cw_anonymous_id lookups require schema migration to add those columns.
 */
router.post(
  "/caption-writer",
  requireAppContext,
  requireAuth,
  migrateCaptionWriterValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const account = res.locals.account;
      const app = res.locals.app;
      const { uuid, cw_anonymous_id, legacy_post_id, rc_customer_id } = req.body;

      // Require at least one device-bound identifier (not email/user_id which are guessable)
      if (!uuid && !cw_anonymous_id && !legacy_post_id) {
        return res.status(400).json(
          formatError("At least one identifier is required (uuid, cw_anonymous_id, or legacy_post_id)")
        );
      }

      // Only proceed for Ghost app
      if (app.slug !== "ghost") {
        return res.status(400).json(
          formatError("CaptionWriter migration is only available for Ghost app")
        );
      }

      let cwUser = null;
      let matchedBy = null;

      // Try to find CW user using device-bound identifiers only
      // (not email/user_id which are guessable and could allow account hijacking)

      // 1. UUID match (requires schema migration - uuid column doesn't exist yet)
      // TODO: Add uuid column to cw_users table to enable this lookup
      if (!cwUser && uuid) {
        // Schema doesn't currently have uuid column
        // When added: cwUser = await knex("cw_users").where("uuid", uuid).first();
        console.log("[Migration] UUID lookup requested but column not yet in schema");
      }

      // 2. Anonymous ID match (requires schema migration - cw_anonymous_id column doesn't exist yet)
      // TODO: Add cw_anonymous_id column to cw_users table to enable this lookup
      if (!cwUser && cw_anonymous_id) {
        // Schema doesn't currently have cw_anonymous_id column
        // When added: cwUser = await knex("cw_users").where("cw_anonymous_id", cw_anonymous_id).first();
        console.log("[Migration] cw_anonymous_id lookup requested but column not yet in schema");
      }

      // 3. Legacy post ID - reverse lookup from cw_captions.local_id
      // Safe because local_id is a client-generated UUID, unguessable
      if (!cwUser && legacy_post_id) {
        const caption = await knex("cw_captions")
          .where("local_id", legacy_post_id)
          .first();

        if (caption) {
          cwUser = await knex("cw_users").where("id", caption.user_id).first();
          if (cwUser) matchedBy = "legacy_post_id";
        }
      }

      // No matching account found
      if (!cwUser) {
        return res.status(200).json(
          successResponse({
            migrated: false,
            reason: "no_matching_account",
          })
        );
      }

      // Check if already migrated to a different account
      if (cwUser.ghost_account_id && cwUser.ghost_account_id !== account.id) {
        return res.status(200).json(
          successResponse({
            migrated: false,
            reason: "already_migrated_to_different_account",
          })
        );
      }

      // Check if already migrated to this account
      if (cwUser.ghost_account_id === account.id) {
        // Already linked - just return current status
        const captionCount = await knex("cw_captions")
          .where("user_id", cwUser.id)
          .count("id as total")
          .first();

        const migratedCount = await knex("cw_captions")
          .where("user_id", cwUser.id)
          .whereNotNull("migrated_at")
          .count("id as count")
          .first();

        return res.status(200).json(
          successResponse({
            migrated: true,
            already_linked: true,
            matched_by: matchedBy,
            subscription_transferred: false,
            drafts_imported: parseInt(migratedCount.count, 10),
            drafts_total: parseInt(captionCount.total, 10),
          })
        );
      }

      // Count captions to migrate
      const captionCountResult = await knex("cw_captions")
        .where("user_id", cwUser.id)
        .whereNull("migrated_at")
        .count("id as count")
        .first();
      const unmigratedCount = parseInt(captionCountResult.count, 10);

      const alreadyMigratedResult = await knex("cw_captions")
        .where("user_id", cwUser.id)
        .whereNotNull("migrated_at")
        .count("id as count")
        .first();
      const alreadyMigratedCount = parseInt(alreadyMigratedResult.count, 10);

      // Link the CW user to the Ghost account
      await knex("cw_users").where("id", cwUser.id).update({
        ghost_account_id: account.id,
        migrated_at: new Date().toISOString(),
      });

      // Queue migration job if there are captions to migrate
      let draftsQueued = 0;
      if (unmigratedCount > 0) {
        await ghostQueue.add(
          JOB_MIGRATE_CW_CAPTIONS,
          {
            cwUserId: cwUser.id,
            ghostAccountId: account.id,
            ghostAppId: app.id,
          },
          {
            // Dedupe - only one migration per CW user at a time
            jobId: `migrate-cw-${cwUser.id}`,
          }
        );
        draftsQueued = unmigratedCount;
        console.log(`[Migration] Queued CW migration for user ${cwUser.id}: ${unmigratedCount} captions`);
      }

      // Queue subscription sync if RevenueCat customer ID provided
      let subscriptionSyncQueued = false;
      if (rc_customer_id) {
        // Store rc_customer_id on account if not already set
        if (!account.rc_customer_id) {
          await account.$query().patch({ rc_customer_id });
          console.log(`[Migration] Stored rc_customer_id on account ${account.id}`);
        }

        await subscriptionQueue.add(
          JOB_SYNC_SUBSCRIPTION_STATUS,
          {
            rcCustomerId: rc_customer_id,
            accountId: account.id,
            appId: app.id,
          },
          {
            jobId: `sync-sub-cw-${rc_customer_id}`,
          }
        );
        subscriptionSyncQueued = true;
        console.log(`[Migration] Queued subscription sync for RC customer ${rc_customer_id}`);
      }

      // Check if the Ghost account already has an active subscription
      const hasExistingSubscription = account.hasActiveSubscription();

      return res.status(200).json(
        successResponse({
          migrated: true,
          matched_by: matchedBy,
          cw_user_id: cwUser.id,
          subscription_sync_queued: subscriptionSyncQueued,
          has_existing_subscription: hasExistingSubscription,
          drafts_queued: draftsQueued,
          drafts_already_migrated: alreadyMigratedCount,
          drafts_total: unmigratedCount + alreadyMigratedCount,
        })
      );
    } catch (error) {
      console.error("[Migration] CaptionWriter migration error:", error);
      return res.status(500).json(
        formatError("Failed to migrate CaptionWriter account")
      );
    }
  }
);

/**
 * GET /migration/caption-writer/status
 *
 * Check the migration status for the current authenticated user.
 * Returns information about any linked CW account and migration progress.
 */
router.get(
  "/caption-writer/status",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const account = res.locals.account;
      const app = res.locals.app;

      if (app.slug !== "ghost") {
        return res.status(400).json(
          formatError("CaptionWriter migration is only available for Ghost app")
        );
      }

      // Find linked CW user
      const cwUser = await knex("cw_users")
        .where("ghost_account_id", account.id)
        .first();

      if (!cwUser) {
        return res.status(200).json(
          successResponse({
            linked: false,
            cw_user: null,
            migration_status: null,
          })
        );
      }

      // Get migration statistics
      const stats = await knex("cw_captions")
        .where("user_id", cwUser.id)
        .select(
          knex.raw("COUNT(*) as total"),
          knex.raw("COUNT(migrated_at) as migrated"),
          knex.raw("COUNT(migration_error) as failed")
        )
        .first();

      const total = parseInt(stats.total, 10);
      const migrated = parseInt(stats.migrated, 10);
      const failed = parseInt(stats.failed, 10);
      const pending = total - migrated;

      return res.status(200).json(
        successResponse({
          linked: true,
          cw_user: {
            id: cwUser.id,
            email: cwUser.email,
            linked_at: cwUser.migrated_at,
          },
          migration_status: {
            total_captions: total,
            migrated: migrated,
            pending: pending,
            failed: failed,
            complete: pending === 0,
            progress_percent: total > 0 ? Math.round((migrated / total) * 100) : 100,
          },
        })
      );
    } catch (error) {
      console.error("[Migration] Status check error:", error);
      return res.status(500).json(
        formatError("Failed to check migration status")
      );
    }
  }
);

export default router;
