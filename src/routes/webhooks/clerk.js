import express from "express";
import { Webhook } from "svix";
import { raw } from "objection";
import { Account, App } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import {
  notificationQueue,
  analyticsQueue,
  NOTIFICATION_JOBS,
  ANALYTICS_JOBS,
} from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

// Clerk webhook endpoint
router.post("/", async (req, res) => {
  try {
    // Verify the webhook signature
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("CLERK_WEBHOOK_SECRET is not set");
      return res.status(500).json(formatError("Webhook configuration error"));
    }

    const headers = req.headers;
    const payload = JSON.stringify(req.body);

    // Create a new Svix webhook instance
    const wh = new Webhook(webhookSecret);
    let event;

    try {
      event = wh.verify(payload, headers);
    } catch (error) {
      console.error("Clerk webhook signature verification failed:", error);
      return res.status(401).json(formatError("Invalid webhook signature"));
    }

    // Log the webhook for debugging (only in development)
    if (process.env.NODE_ENV === "development") {
      console.log("Clerk webhook received:", {
        type: event.type,
        user_id: event.data?.id,
        timestamp: new Date().toISOString(),
      });
    }

    // Process the webhook event
    await processClerkEvent(event);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Clerk webhook error:", error);
    return res.status(500).json(formatError("Failed to process webhook"));
  }
});

const processClerkEvent = async (event) => {
  const { type, data } = event;

  switch (type) {
    case "user.created":
      await handleUserCreated(data);
      break;

    case "user.updated":
      await handleUserUpdated(data);
      break;

    case "user.deleted":
      await handleUserDeleted(data);
      break;

    case "session.created":
      await handleSessionCreated(data);
      break;

    case "session.ended":
      await handleSessionEnded(data);
      break;

    default:
      if (process.env.NODE_ENV === "development") {
        console.log(`Unhandled Clerk webhook event: ${type}`);
      }
  }
};

const handleUserCreated = async (userData) => {
  try {
    // Track user creation analytics
    await analyticsQueue.add(ANALYTICS_JOBS.UPDATE_USER_ANALYTICS, {
      clerkUserId: userData.id,
      event: "user_created",
      metadata: {
        email: userData.email_addresses?.[0]?.email_address,
        created_at: new Date(userData.created_at).toISOString(),
        sign_up_method: userData.external_accounts?.[0]?.provider || "email",
      },
    });

    // Note: We don't create Account records here because they are app-scoped
    // Accounts are created when users first authenticate with a specific app
  } catch (error) {
    console.error("Error handling user.created:", error);
    throw error;
  }
};

const handleUserUpdated = async (userData) => {
  try {
    // Find all accounts for this user across apps
    const accounts = await Account.query().where("clerk_id", userData.id);

    if (accounts.length === 0) {
      return;
    }

    // Update account information across all apps
    const updateData = {
      email: userData.email_addresses?.[0]?.email_address,
      metadata: {
        ...accounts[0].metadata, // Preserve existing metadata
        clerk_updated_at: new Date(userData.updated_at).toISOString(),
        profile_image_url: userData.profile_image_url,
        first_name: userData.first_name,
        last_name: userData.last_name,
      },
    };

    await Account.query().where("clerk_id", userData.id).patch(updateData);

    // Track user update analytics
    await analyticsQueue.add(ANALYTICS_JOBS.UPDATE_USER_ANALYTICS, {
      clerkUserId: userData.id,
      event: "user_updated",
      metadata: {
        accounts_updated: accounts.length,
        email: userData.email_addresses?.[0]?.email_address,
      },
    });
  } catch (error) {
    console.error("Error handling user.updated:", error);
    throw error;
  }
};

const handleUserDeleted = async (userData) => {
  try {
    // Find all accounts for this user
    const accounts = await Account.query()
      .where("clerk_id", userData.id)
      .withGraphFetched("[actors, artifacts, inputs, subscriptions]");

    if (accounts.length === 0) {
      return;
    }

    // Track what we're about to delete for analytics
    const deletionSummary = {
      accounts_count: accounts.length,
      actors_count: accounts.reduce(
        (sum, acc) => sum + (acc.actors?.length || 0),
        0
      ),
      artifacts_count: accounts.reduce(
        (sum, acc) => sum + (acc.artifacts?.length || 0),
        0
      ),
      inputs_count: accounts.reduce(
        (sum, acc) => sum + (acc.inputs?.length || 0),
        0
      ),
      subscriptions_count: accounts.reduce(
        (sum, acc) => sum + (acc.subscriptions?.length || 0),
        0
      ),
    };

    // Soft delete approach - mark as deleted but keep data for a period
    const deletedAt = new Date().toISOString();
    await Account.query()
      .where("clerk_id", userData.id)
      .patch({
        metadata: raw(
          `metadata || '{"deleted_at": "${deletedAt}", "deletion_reason": "user_deleted_clerk"}'`
        ),
      });

    // Track user deletion analytics
    await analyticsQueue.add(ANALYTICS_JOBS.UPDATE_USER_ANALYTICS, {
      clerkUserId: userData.id,
      event: "user_deleted",
      metadata: {
        ...deletionSummary,
        deleted_at: deletedAt,
      },
    });

    // Queue cleanup job for later (hard delete after retention period)
    // This would be handled by a separate cleanup worker
  } catch (error) {
    console.error("Error handling user.deleted:", error);
    throw error;
  }
};

const handleSessionCreated = async (sessionData) => {
  // Track session analytics
  await analyticsQueue.add(ANALYTICS_JOBS.UPDATE_USER_ANALYTICS, {
    clerkUserId: sessionData.user_id,
    event: "session_created",
    metadata: {
      session_id: sessionData.id,
      created_at: new Date(sessionData.created_at).toISOString(),
    },
  });
};

const handleSessionEnded = async (sessionData) => {
  // Track session analytics
  await analyticsQueue.add(ANALYTICS_JOBS.UPDATE_USER_ANALYTICS, {
    clerkUserId: sessionData.user_id,
    event: "session_ended",
    metadata: {
      session_id: sessionData.id,
      ended_at: new Date().toISOString(),
      abandon_reason: sessionData.abandon_reason,
    },
  });
};

export default router;
