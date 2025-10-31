import express from "express";
import { body } from "express-validator";
import {
  requireAppContext,
  requireAuth,
  handleValidationErrors,
} from "#src/middleware/index.js";
import {
  currentAccountSerializer,
  successResponse,
} from "#src/serializers/index.js";
import { formatError } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

const updateAccountValidators = [
  body("name")
    .optional({ nullable: true })
    .isLength({ min: 1, max: 100 })
    .withMessage("Account name must be 1-100 characters"),
  body("metadata")
    .optional()
    .isObject()
    .withMessage("Metadata must be an object"),
  body("metadata.display_name")
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage("Display name must be 1-100 characters"),
  // Future account fields can be added here
  // body("timezone").optional().isString(),
  // body("language").optional().isString(),
  // etc.
];

router.get("/me", requireAppContext, requireAuth, async (req, res) => {
  try {
    const account = res.locals.account;

    // Get counts for stats
    const { Actor, Artifact } = await import("#src/models/index.js");
    let actorsCount = 0;
    let artifactsCount = 0;

    try {
      [actorsCount, artifactsCount] = await Promise.all([
        Actor.query().where("account_id", account.id).resultSize(),
        Artifact.query().where("account_id", account.id).resultSize(),
      ]);
    } catch (error) {
      console.warn("Failed to get counts for account stats:", error);
    }

    // Add counts to account for serializer
    account.actors = { length: actorsCount };
    account.artifacts = { length: artifactsCount };

    const data = currentAccountSerializer(account);
    return res
      .status(200)
      .json(successResponse(data, "Account details retrieved"));
  } catch (error) {
    console.error("Get account error:", error);
    return res
      .status(500)
      .json(formatError("Failed to retrieve account details"));
  }
});

router.patch(
  "/me",
  requireAppContext,
  requireAuth,
  updateAccountValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const account = res.locals.account;
      const { name, metadata } = req.body;

      let updatedAccount;

      // If name is being updated, use the special method that regenerates display name
      if (name !== undefined) {
        updatedAccount = await account.updateAccountName(name);

        // Also update metadata if provided
        if (metadata) {
          updatedAccount = await updatedAccount.$query().patchAndFetch({
            metadata: {
              ...updatedAccount.metadata,
              ...metadata,
            },
          });
        }
      } else {
        // Only updating metadata
        updatedAccount = await account.$query().patchAndFetch({
          metadata: {
            ...account.metadata,
            ...metadata,
          },
        });
      }

      // Use the updated account directly (app relationship already loaded from middleware)
      updatedAccount.app = account.app;

      const data = currentAccountSerializer(updatedAccount);
      return res
        .status(200)
        .json(successResponse(data, "Account updated successfully"));
    } catch (error) {
      console.error("Update account error:", error);
      return res.status(500).json(formatError("Failed to update account"));
    }
  }
);

// Regenerate display name based on current children
router.post(
  "/me/regenerate-display-name",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const account = res.locals.account;

      // Regenerate display name based on current data
      const displayName = await account.generateDisplayName();

      // Update the account with new display name
      const updatedAccount = await account.$query().patchAndFetch({
        metadata: {
          ...account.metadata,
          display_name: displayName,
          display_name_updated_at: new Date().toISOString(),
          display_name_source: account.name ? "account_name" : "children_names",
        },
      });

      // Use the updated account directly (app relationship already loaded from middleware)
      updatedAccount.app = account.app;

      const data = currentAccountSerializer(updatedAccount);
      return res
        .status(200)
        .json(successResponse(data, "Display name regenerated successfully"));
    } catch (error) {
      console.error("Regenerate display name error:", error);
      return res
        .status(500)
        .json(formatError("Failed to regenerate display name"));
    }
  }
);

// Update account settings (timezone, generation_time, notifications)
router.patch(
  "/me/settings",
  requireAppContext,
  requireAuth,
  [
    body("timezone")
      .optional()
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage("Timezone must be a valid IANA timezone string"),
    body("generation_time")
      .optional()
      .isInt({ min: 0, max: 23 })
      .withMessage("Generation time must be an integer between 0 and 23"),
    body("notifications_enabled")
      .optional()
      .isBoolean()
      .withMessage("Notifications enabled must be a boolean"),
    body("notification_prompt_shown")
      .optional()
      .isBoolean()
      .withMessage("Notification prompt shown must be a boolean"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const account = res.locals.account;
      const { timezone, generation_time, notifications_enabled, notification_prompt_shown } = req.body;

      // Validate timezone if provided
      if (timezone) {
        try {
          // Quick validation: try to get timezone offset
          // This will throw if timezone is invalid
          Intl.DateTimeFormat(undefined, { timeZone: timezone });
        } catch (error) {
          return res.status(400).json(formatError("Invalid timezone format. Please use IANA timezone (e.g., America/New_York)"));
        }
      }

      const updates = {};
      if (timezone !== undefined) updates.timezone = timezone;
      if (generation_time !== undefined) updates.generation_time = generation_time;
      if (notifications_enabled !== undefined) updates.notifications_enabled = notifications_enabled;
      if (notification_prompt_shown !== undefined) updates.notification_prompt_shown = notification_prompt_shown;

      // Update account - generation_time_utc will be auto-calculated by beforeUpdate hook
      const updatedAccount = await account.$query().patchAndFetch(updates);

      // Reload with app relationship
      updatedAccount.app = account.app;

      const data = {
        timezone: updatedAccount.timezone,
        generation_time: updatedAccount.generation_time,
        generation_time_utc: updatedAccount.generation_time_utc,
        notifications_enabled: updatedAccount.notifications_enabled,
        notification_prompt_shown: updatedAccount.notification_prompt_shown,
      };

      return res.status(200).json(successResponse(data, "Settings updated successfully"));
    } catch (error) {
      console.error("Update settings error:", error);
      return res.status(500).json(formatError("Failed to update settings"));
    }
  }
);

router.delete("/me", requireAppContext, requireAuth, async (req, res) => {
  try {
    const account = res.locals.account;
    const { ConnectedAccount } = await import("#src/models/index.js");

    // Get all connected accounts
    const connections = await ConnectedAccount.query()
      .where("account_id", account.id)
      .where("app_id", res.locals.app.id)
      .where("is_active", true);

    // Soft delete all connected accounts (disconnect all platforms)
    if (connections.length > 0) {
      await ConnectedAccount.query()
        .where("account_id", account.id)
        .where("app_id", res.locals.app.id)
        .where("is_active", true)
        .patch({
          is_active: false,
          metadata: ConnectedAccount.raw(
            "jsonb_set(metadata, '{disconnected_at}', to_jsonb(?::text))",
            [new Date().toISOString()]
          ),
        });
    }

    // Soft delete account by updating metadata
    await account.$query().patch({
      metadata: {
        ...account.metadata,
        deleted_at: new Date().toISOString(),
        deletion_reason: "user_requested",
        disconnected_platforms: connections.length,
      },
    });

    return res.status(200).json(
      successResponse(
        {
          message: "Account deleted successfully",
          disconnected_platforms: connections.length,
          subscription_notice:
            "Please note: We cannot automatically cancel your subscription. Please manage your subscription through your payment provider (App Store, Google Play, or Stripe).",
        },
        "Account deleted successfully"
      )
    );
  } catch (error) {
    console.error("Delete account error:", error);
    return res.status(500).json(formatError("Failed to delete account"));
  }
});

export default router;
