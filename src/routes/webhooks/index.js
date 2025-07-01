import express from "express";
import clerkWebhook from "#src/routes/webhooks/clerk.js";
import revenuecatWebhook from "#src/routes/webhooks/revenuecat.js";
import mediaWebhook from "#src/routes/webhooks/media.js";
import contentSafetyWebhook from "#src/routes/webhooks/content-safety.js";

const router = express.Router();

// Raw body parsing for webhooks (signatures need raw body)
router.use(express.raw({ type: 'application/json', limit: '5mb' }));

// Convert raw body back to JSON for processing
router.use((req, res, next) => {
  if (req.body && req.body.length > 0) {
    try {
      // Store raw body for signature verification
      req.rawBody = req.body;
      // Parse JSON for route handlers
      req.body = JSON.parse(req.body.toString());
    } catch (error) {
      console.error("Error parsing webhook JSON:", error);
      return res.status(400).json({ error: "Invalid JSON payload" });
    }
  }
  next();
});

// Webhook routes
router.use("/clerk", clerkWebhook);
router.use("/revenuecat", revenuecatWebhook);
router.use("/media", mediaWebhook);
router.use("/content-safety", contentSafetyWebhook);

// Health check for webhook endpoint monitoring
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    webhooks: {
      clerk: "active",
      revenuecat: "active", 
      media: "active",
      content_safety: "active",
    },
  });
});

// Webhook endpoint discovery
router.get("/", (req, res) => {
  res.status(200).json({
    webhooks: {
      clerk: {
        endpoint: "/webhooks/clerk",
        description: "Handles Clerk authentication events (user.created, user.updated, user.deleted, session events)",
        required_headers: ["svix-id", "svix-timestamp", "svix-signature"],
      },
      revenuecat: {
        endpoint: "/webhooks/revenuecat",
        description: "Handles RevenueCat subscription events (purchases, renewals, cancellations)",
        required_headers: ["x-revenuecat-signature"],
      },
      media: {
        endpoint: "/webhooks/media",
        description: "Handles media processing events (uploads, optimization, failures)",
        required_headers: ["x-media-signature"],
      },
      content_safety: {
        endpoint: "/webhooks/content-safety",
        description: "Handles AI moderation and content safety events",
        required_headers: ["x-safety-signature"],
      },
    },
    security: {
      signature_verification: "Required for production endpoints",
      rate_limiting: "Applied per webhook source",
      ip_whitelisting: "Configurable via environment variables",
    },
  });
});

export default router;