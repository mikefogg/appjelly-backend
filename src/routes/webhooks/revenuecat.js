import express from "express";
import formatError from "#src/helpers/format-error.js";
import { App, WebhookEvent } from "#src/models/index.js";
import {
  subscriptionQueue,
  JOB_PROCESS_REVENUECAT_WEBHOOK,
} from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

// RevenueCat webhook endpoint
// URL: /webhooks/revenuecat/:appSlug
router.post("/:appSlug", async (req, res) => {
  try {
    const { appSlug } = req.params;
    const webhookData = req.body;

    // Look up the app by slug
    const app = await App.query().findOne({ slug: appSlug });
    if (!app) {
      return res.status(404).json(formatError("App not found", 404));
    }

    // Validate authorization header
    // RevenueCat sends the header value exactly as configured in their dashboard
    if (process.env.REVENUECAT_WEBHOOK_AUTH_KEY) {
      const authHeader = req.headers["authorization"];

      if (!authHeader || authHeader !== process.env.REVENUECAT_WEBHOOK_AUTH_KEY) {
        return res.status(401).json(formatError("Invalid webhook authorization", 401));
      }
    }

    // Log the raw webhook event for replay capability
    const webhookEvent = await WebhookEvent.logEvent({
      source: "revenuecat",
      eventType: webhookData.event?.type,
      eventId: webhookData.event?.id,
      payload: webhookData,
      appId: app.id,
    });

    // Queue background job for comprehensive processing
    // This handles: notifications, analytics, user updates, etc.
    await subscriptionQueue.add(
      JOB_PROCESS_REVENUECAT_WEBHOOK,
      {
        event: webhookData.event,
        appId: app.id,
        appSlug: app.slug,
        webhookEventId: webhookEvent.id,
      },
      {
        priority: getEventPriority(webhookData.event?.type),
        delay: 0, // Process immediately
      }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("RevenueCat webhook error:", error);
    }
    return res.status(500).json(formatError("Failed to process webhook"));
  }
});

// Helper function to prioritize different webhook event types
function getEventPriority(eventType) {
  const priorities = {
    INITIAL_PURCHASE: 1, // Highest priority - new customer
    RENEWAL: 2, // High priority - existing customer retention
    CANCELLATION: 3, // High priority - churn prevention
    BILLING_ISSUE: 4, // Medium-high priority - revenue protection
    TRANSFER: 5, // Medium priority - user experience
    PRODUCT_CHANGE: 6, // Medium priority - user experience
    UNCANCELLATION: 7, // Medium priority - positive event
    SUBSCRIPTION_EXTENDED: 8, // Medium priority - positive event
    EXPIRATION: 9, // Lower priority - expected event
    NON_RENEWING_PURCHASE: 10, // Lower priority - one-time event
  };

  return priorities[eventType] || 10; // Default to lowest priority
}

export default router;
