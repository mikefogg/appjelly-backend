import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "#src/index.js";
import { createAuthenticatedUser, createSubscription } from "../../helpers/mock-data.js";
import { expectSuccessResponse, expectErrorResponse, expectValidationError } from "../../helpers/assertions.js";


// Mock external RevenueCat API
global.fetch = vi.fn((url) => {
  if (url.includes('revenuecat.com')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        request_date: new Date().toISOString(),
        subscriber: {
          entitlements: {
            pro_access: {
              expires_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              product_identifier: "pro_monthly"
            }
          }
        }
      })
    });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
});

describe("Subscriptions Routes", () => {
  let user;
  let headers;

  beforeEach(async () => {
    user = await createAuthenticatedUser();
    headers = {
      "X-App-Slug": user.app.slug,
      "X-Test-User-Id": user.account.clerk_id,
    };
  });

  describe("GET /subscriptions/status", () => {
    it("returns subscription status with active subscription", async () => {
      const subscription = await createSubscription(user.account, {
        rc_renewal_status: "active",
        rc_entitlement: "pro_access"
      });

      const response = await request(app)
        .get("/subscriptions/status")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("has_active_subscription", true);
      expect(data).toHaveProperty("entitlement", "pro_access");
      expect(data).toHaveProperty("renewal_status", "active");
      expect(data).toHaveProperty("expires_at");
    });

    it("returns status without subscription", async () => {
      const response = await request(app)
        .get("/subscriptions/status")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("has_active_subscription", false);
      expect(data.entitlement).toBeNull();
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .get("/subscriptions/status")
        .set("X-App-Slug", user.app.slug);

      expectErrorResponse(response, 401);
    });
  });

  describe("POST /subscriptions/paywall", () => {
    it("logs paywall interaction", async () => {
      const response = await request(app)
        .post("/subscriptions/paywall")
        .set(headers)
        .send({
          event_type: "paywall_shown",
          product_id: "pro_monthly",
          metadata: { screen: "story_generation" }
        });

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("logged", true);
      expect(data).toHaveProperty("timestamp");
      expect(data).toHaveProperty("metadata");
      expect(data.metadata).toHaveProperty("product_id", "pro_monthly");
    });

    it("validates event type", async () => {
      const response = await request(app)
        .post("/subscriptions/paywall")
        .set(headers)
        .send({
          event_type: "invalid_event",
          product_id: "pro_monthly"
        });

      expectValidationError(response, "event_type");
    });

    it("handles rate limiting", async () => {
      // Make many requests quickly
      const promises = Array(102).fill().map(() =>
        request(app)
          .post("/subscriptions/paywall")
          .set(headers)
          .send({
            event_type: "paywall_shown",
            product_id: "pro_monthly"
          })
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited (429 status)
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe("GET /subscriptions/products", () => {
    it("returns available subscription products", async () => {
      const response = await request(app)
        .get("/subscriptions/products")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data.products)).toBe(true);
      expect(data.products.length).toBeGreaterThan(0);
      
      const product = data.products[0];
      expect(product).toHaveProperty("id");
      expect(product).toHaveProperty("title");
      expect(product).toHaveProperty("price");
      expect(product).toHaveProperty("features");
      expect(Array.isArray(product.features)).toBe(true);
    });

    it("filters products based on app configuration", async () => {
      // Update app config to limit products
      await user.app.$query().patch({
        config: {
          ...user.app.config,
          subscription: {
            products: ["pro_yearly"] // Only yearly plan
          }
        }
      });

      const response = await request(app)
        .get("/subscriptions/products")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.products).toHaveLength(1);
      expect(data.products[0].id).toBe("pro_yearly");
    });
  });

  describe("GET /subscriptions/entitlements/:entitlement", () => {
    it("checks specific entitlement", async () => {
      // Create active subscription first
      await createSubscription(user.account, {
        rc_renewal_status: "active",
        rc_entitlement: "pro_access",
        rc_expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });

      const response = await request(app)
        .get("/subscriptions/entitlements/pro_access")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.entitlement).toBe("pro_access");
      expect(data.has_access).toBe(true);
      expect(data.reason).toBe("active_subscription");
      expect(data).toHaveProperty("expires_at");
    });

    it("handles unknown entitlement", async () => {
      // Test without creating a subscription - should return no access
      const response = await request(app)
        .get("/subscriptions/entitlements/unknown_entitlement")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.has_access).toBe(false);
      expect(data.reason).toBe("No active subscription");
    });
  });

  describe("GET /subscriptions/usage", () => {
    it("returns usage statistics", async () => {
      // Create some artifacts to show usage
      const { createActor, createInput, createArtifact } = await import("../../helpers/mock-data.js");
      const actor = await createActor(user.account);
      const input = await createInput(user.account, [actor]);
      await createArtifact(input);
      await createArtifact(input);

      const response = await request(app)
        .get("/subscriptions/usage")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("current_period");
      expect(data.current_period).toHaveProperty("artifacts_created", 2);
      expect(data.current_period).toHaveProperty("actors_created", 1);
      
      expect(data).toHaveProperty("limits");
      expect(data.limits).toHaveProperty("max_stories_per_month");
      expect(data.limits).toHaveProperty("stories_remaining");
    });

    it("shows unlimited usage for pro subscribers", async () => {
      await createSubscription(user.account, {
        rc_entitlement: "pro_access",
        rc_renewal_status: "active"
      });

      const response = await request(app)
        .get("/subscriptions/usage")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.limits.max_stories_per_month).toBe(-1); // Unlimited
      expect(data.limits.stories_remaining).toBe(-1); // Unlimited
    });

    it("shows limited usage for free users", async () => {
      const response = await request(app)
        .get("/subscriptions/usage")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.limits.max_stories_per_month).toBe(5); // Free tier limit
      expect(typeof data.limits.stories_remaining).toBe("number");
      expect(data.limits.stories_remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe("POST /subscriptions/events", () => {
    it("logs subscription events", async () => {
      const response = await request(app)
        .post("/subscriptions/events")
        .set(headers)
        .send({
          event_type: "subscription_started",
          metadata: { 
            product_id: "pro_monthly",
            platform: "ios"
          }
        });

      expectSuccessResponse(response);
    });

    it("validates event type", async () => {
      const response = await request(app)
        .post("/subscriptions/events")
        .set(headers)
        .send({
          event_type: "invalid_event"
        });

      expectValidationError(response, "event_type");
    });

    it("handles rate limiting", async () => {
      // Make many requests quickly
      const promises = Array(52).fill().map(() =>
        request(app)
          .post("/subscriptions/events")
          .set(headers)
          .send({
            event_type: "subscription_started"
          })
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe("Multi-tenant isolation", () => {
    it("isolates subscription data by app", async () => {
      const otherUser = await createAuthenticatedUser({ appSlug: "other-app" });
      await createSubscription(otherUser.account, { rc_entitlement: "pro_access" });

      // Current user should not see other app's subscription
      const response = await request(app)
        .get("/subscriptions/status")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.has_active_subscription).toBe(false);
    });
  });

  describe("Business logic", () => {
    it("calculates usage correctly across multiple periods", async () => {
      const { createActor, createInput, createArtifact } = await import("../../helpers/mock-data.js");
      
      // Create content in current month
      const actor = await createActor(user.account);
      const input = await createInput(user.account, [actor]);
      await createArtifact(input);

      const response = await request(app)
        .get("/subscriptions/usage")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.current_period.artifacts_created).toBe(1);
      expect(data.current_period).toHaveProperty("start_date");
    });
  });
});