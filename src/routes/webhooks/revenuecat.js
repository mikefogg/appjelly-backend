import express from "express";
import subscriptionService from "#src/helpers/subscription-service.js";
import formatError from "#src/helpers/format-error.js";
import {
  subscriptionQueue,
  JOB_PROCESS_REVENUECAT_WEBHOOK,
} from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

// RevenueCat webhook endpoint
router.post("/", async (req, res) => {
  try {
    const webhookData = req.body;

    // Validate webhook signature if configured
    const signature = req.headers["x-revenuecat-signature"];
    if (process.env.REVENUECAT_WEBHOOK_SECRET && signature) {
      // TODO: Implement signature validation
      // const isValidSignature = validateRevenueCatSignature(req.body, signature, process.env.REVENUECAT_WEBHOOK_SECRET);
      // if (!isValidSignature) {
      //   return res.status(401).json(formatError("Invalid webhook signature"));
      // }
    }

    // Queue background job for comprehensive processing
    // This handles: notifications, analytics, user updates, etc.
    await subscriptionQueue.add(
      JOB_PROCESS_REVENUECAT_WEBHOOK,
      { event: webhookData.event },
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
