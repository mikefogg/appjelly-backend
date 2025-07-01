import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "#src/index.js";

// Mock background queues - this is all we need to test
vi.mock("#src/background/queues/index.js", () => ({
  subscriptionQueue: {
    add: vi.fn().mockResolvedValue({ id: "job_123" }),
  },
  JOB_PROCESS_REVENUECAT_WEBHOOK: "process-revenuecat-webhook",
}));

describe("RevenueCat Webhook Routes", () => {
  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
  });

  describe("POST /webhooks/revenuecat", () => {
    const createWebhookPayload = (
      eventType = "INITIAL_PURCHASE",
      overrides = {}
    ) => ({
      event: {
        type: eventType,
        app_user_id: "user_12345",
        original_app_user_id: "user_12345",
        aliases: ["user_12345", "$RCAnonymousID:abc123"],
        product_id: "pro_monthly",
        entitlement_ids: ["pro_access"],
        period_type: "normal",
        store: "app_store",
        environment: "production",
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
        ...overrides,
      },
      api_version: "1.0",
    });

    it("queues job for valid webhook", async () => {
      const webhookData = createWebhookPayload();

      const response = await request(app)
        .post("/webhooks/revenuecat")
        .send(webhookData);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });

      // Verify the correct job was queued
      const { subscriptionQueue } = await import(
        "#src/background/queues/index.js"
      );
      expect(subscriptionQueue.add).toHaveBeenCalledWith(
        "process-revenuecat-webhook",
        { event: webhookData.event },
        expect.objectContaining({
          priority: 1, // INITIAL_PURCHASE has highest priority
          delay: 0,
        })
      );
    });

    it("queues jobs with correct priorities for different event types", async () => {
      const eventPriorities = [
        ["INITIAL_PURCHASE", 1],
        ["RENEWAL", 2],
        ["CANCELLATION", 3],
        ["BILLING_ISSUE", 4],
        ["EXPIRATION", 9],
      ];

      for (const [eventType, expectedPriority] of eventPriorities) {
        const webhookData = createWebhookPayload(eventType);

        const response = await request(app).post("/webhooks/revenuecat").send(webhookData);
        expect(response.status).toBe(200);

        const { subscriptionQueue } = await import(
          "#src/background/queues/index.js"
        );
        expect(subscriptionQueue.add).toHaveBeenCalledWith(
          "process-revenuecat-webhook",
          { event: webhookData.event },
          expect.objectContaining({
            priority: expectedPriority,
          })
        );
      }
    });

    it("handles queue failures gracefully", async () => {
      // Mock the queue to throw an error
      const { subscriptionQueue } = await import(
        "#src/background/queues/index.js"
      );
      subscriptionQueue.add.mockRejectedValueOnce(new Error("Queue is down"));

      const webhookData = createWebhookPayload();

      const response = await request(app)
        .post("/webhooks/revenuecat")
        .send(webhookData);

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        error: { message: "Failed to process webhook" }
      });
    });
  });

  describe("Webhook signature validation", () => {
    it("processes webhook without signature validation (TODO: implement)", async () => {
      const webhookData = createWebhookPayload();

      const response = await request(app)
        .post("/webhooks/revenuecat")
        .send(webhookData);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      
      // Verify job was still queued
      const { subscriptionQueue } = await import(
        "#src/background/queues/index.js"
      );
      expect(subscriptionQueue.add).toHaveBeenCalled();
    });
  });

  // Helper function same as in the route
  const createWebhookPayload = (
    eventType = "INITIAL_PURCHASE",
    overrides = {}
  ) => ({
    event: {
      type: eventType,
      app_user_id: "user_12345",
      original_app_user_id: "user_12345",
      aliases: ["user_12345", "$RCAnonymousID:abc123"],
      product_id: "pro_monthly",
      entitlement_ids: ["pro_access"],
      period_type: "normal",
      store: "app_store",
      environment: "production",
      expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      ...overrides,
    },
    api_version: "1.0",
  });
});
