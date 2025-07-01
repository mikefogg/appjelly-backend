import express from "express";
import { body } from "express-validator";
import { requireAuth, requireAppContext,  handleValidationErrors, rateLimitByAccount } from "#src/middleware/index.js";
import { Subscription } from "#src/models/index.js";
import { subscriptionStatusSerializer, paywallSerializer, successResponse } from "#src/serializers/index.js";
import { formatError, subscriptionService } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

const paywallEventValidators = [
  body("event_type").isIn(["paywall_shown", "paywall_dismissed", "purchase_attempted", "purchase_cancelled"]).withMessage("Invalid event type"),
  body("product_id").optional().isString().withMessage("Product ID must be a string"),
  body("metadata").optional().isObject().withMessage("Metadata must be an object"),
];

const subscriptionEventValidators = [
  body("event_type").isIn(["subscription_started", "subscription_renewed", "subscription_cancelled", "billing_issue"]).withMessage("Invalid event type"),
  body("metadata").optional().isObject().withMessage("Metadata must be an object"),
];

router.get(
  "/status",
  requireAppContext, requireAuth,
  
  async (req, res) => {
    try {

      // Get active subscription
      const activeSubscription = await Subscription.findActiveByAccount(res.locals.account.id);

      const data = subscriptionStatusSerializer({
        ...res.locals.account,
        subscriptions: activeSubscription ? [activeSubscription] : [],
      });

      return res.status(200).json(successResponse(data, "Subscription status retrieved successfully"));
    } catch (error) {
      console.error("Get subscription status error:", error);
      return res.status(500).json(formatError("Failed to retrieve subscription status"));
    }
  }
);

router.post(
  "/paywall",
  requireAppContext, requireAuth,
  
  rateLimitByAccount(100, 3600000), // 100 paywall events per hour
  paywallEventValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { event_type, product_id, metadata = {} } = req.body;

      // Log paywall interaction
      const timestamp = new Date().toISOString();
      const logMetadata = {
        product_id,
        timestamp,
        app_id: res.locals.app.id,
        ...metadata,
      };
      
      await subscriptionService.logPaywallInteraction(res.locals.account.id, event_type, logMetadata);

      const data = {
        logged: true,
        timestamp,
        event_type,
        metadata: logMetadata,
      };

      return res.status(200).json(successResponse(data, "Paywall interaction logged successfully"));
    } catch (error) {
      console.error("Log paywall interaction error:", error);
      return res.status(500).json(formatError("Failed to log paywall interaction"));
    }
  }
);

router.get(
  "/products",
  requireAppContext, requireAuth,
  
  async (req, res) => {
    try {

      // Mock product data - in real implementation, this would come from RevenueCat or app config
      const products = [
        {
          id: "pro_monthly",
          identifier: "pro_monthly",
          title: "Pro Monthly",
          description: "Unlimited stories and premium features",
          price: "$4.99",
          currency: "USD",
          period: "P1M",
          entitlements: ["pro_access"],
          features: [
            "Unlimited stories per month",
            "Premium character types", 
            "Advanced sharing options",
            "Priority support",
          ],
        },
        {
          id: "pro_yearly",
          identifier: "pro_yearly", 
          title: "Pro Yearly",
          description: "Best value - unlimited stories and premium features",
          price: "$39.99",
          currency: "USD",
          period: "P1Y",
          entitlements: ["pro_access"],
          features: [
            "Unlimited stories per month",
            "Premium character types",
            "Advanced sharing options", 
            "Priority support",
            "Save 33% vs monthly",
          ],
        },
      ];

      // Filter products based on app configuration
      const availableProducts = products.filter(product => {
        const appProducts = res.locals.app.config?.subscription?.products || [];
        return appProducts.length === 0 || appProducts.includes(product.id);
      });

      const data = paywallSerializer(availableProducts);
      return res.status(200).json(successResponse(data, "Subscription products retrieved successfully"));
    } catch (error) {
      console.error("Get subscription products error:", error);
      return res.status(500).json(formatError("Failed to retrieve subscription products"));
    }
  }
);

router.post(
  "/events",
  requireAppContext, requireAuth,
  
  rateLimitByAccount(50, 3600000), // 50 subscription events per hour
  subscriptionEventValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { event_type, metadata = {} } = req.body;

      // Log subscription event for analytics
      const eventData = {
        account_id: res.locals.account.id,
        app_id: res.locals.app.id,
        event_type,
        timestamp: new Date().toISOString(),
        ...metadata,
      };


      // In a real implementation, this would be sent to an analytics service
      // await analyticsService.track('subscription_event', eventData);

      return res.status(200).json(successResponse(null, "Subscription event logged successfully"));
    } catch (error) {
      console.error("Log subscription event error:", error);
      return res.status(500).json(formatError("Failed to log subscription event"));
    }
  }
);

// Check entitlement for specific features
router.get(
  "/entitlements/:entitlement",
  requireAppContext, requireAuth,
  
  async (req, res) => {
    try {
      const { entitlement } = req.params;

      const entitlementCheck = await subscriptionService.checkEntitlement(res.locals.account, entitlement);

      const data = {
        entitlement,
        has_access: entitlementCheck.hasAccess,
        reason: entitlementCheck.reason,
        expires_at: entitlementCheck.expiresAt || null,
        subscription: entitlementCheck.subscription ? {
          id: entitlementCheck.subscription.id,
          rc_product_id: entitlementCheck.subscription.rc_product_id,
          rc_renewal_status: entitlementCheck.subscription.rc_renewal_status,
        } : null,
      };

      return res.status(200).json(successResponse(data, "Entitlement check completed"));
    } catch (error) {
      console.error("Check entitlement error:", error);
      return res.status(500).json(formatError("Failed to check entitlement"));
    }
  }
);

// Get subscription usage stats
router.get(
  "/usage",
  requireAppContext, requireAuth,
  
  async (req, res) => {
    try {

      // Get current month's usage
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { Artifact, Actor } = await import("#src/models/index.js");

      const [artifactsThisMonth, totalActors] = await Promise.all([
        Artifact.query()
          .where("account_id", res.locals.account.id)
          .where("app_id", res.locals.app.id)
          .where("created_at", ">=", startOfMonth.toISOString())
          .resultSize(),
        Actor.query()
          .where("account_id", res.locals.account.id)
          .where("app_id", res.locals.app.id)
          .resultSize(),
      ]);

      // Get limits based on subscription
      const activeSubscription = await Subscription.findActiveByAccount(res.locals.account.id);
      const limits = activeSubscription?.hasEntitlement("pro_access") 
        ? { max_stories_per_month: -1, max_actors: -1 } // Unlimited
        : { max_stories_per_month: 5, max_actors: 3 }; // Free tier

      const data = {
        current_period: {
          start_date: startOfMonth.toISOString(),
          artifacts_created: artifactsThisMonth,
          actors_created: totalActors,
        },
        limits: {
          max_stories_per_month: limits.max_stories_per_month,
          max_actors: limits.max_actors,
          stories_remaining: limits.max_stories_per_month === -1 
            ? -1 
            : Math.max(0, limits.max_stories_per_month - artifactsThisMonth),
          actors_remaining: limits.max_actors === -1 
            ? -1 
            : Math.max(0, limits.max_actors - totalActors),
        },
        subscription: activeSubscription ? {
          entitlement: activeSubscription.rc_entitlement,
          status: activeSubscription.rc_renewal_status,
          expires_at: activeSubscription.rc_expiration,
        } : null,
      };

      return res.status(200).json(successResponse(data, "Usage statistics retrieved successfully"));
    } catch (error) {
      console.error("Get usage stats error:", error);
      return res.status(500).json(formatError("Failed to retrieve usage statistics"));
    }
  }
);

export default router;