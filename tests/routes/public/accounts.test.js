import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "#src/index.js";
import { createAuthenticatedUser } from "../../helpers/mock-data.js";
import { expectSuccessResponse, expectErrorResponse, expectValidationError } from "../../helpers/assertions.js";

describe("Accounts Routes", () => {
  let user;
  let headers;

  beforeEach(async () => {
    user = await createAuthenticatedUser();
    headers = {
      "X-App-Slug": user.app.slug,
      "X-Test-User-Id": user.account.clerk_id,
    };
  });

  describe("GET /accounts/me", () => {
    it("returns current account details", async () => {
      const response = await request(app)
        .get("/accounts/me")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.id).toBe(user.account.id);
      expect(data.clerk_id).toBe(user.account.clerk_id);
      expect(data.email).toBe(user.account.email);
      expect(data.app).toHaveProperty("slug", user.app.slug);
    });

    it("includes related data in response", async () => {
      const response = await request(app)
        .get("/accounts/me")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("app");
      expect(data).toHaveProperty("subscription");
      expect(data).toHaveProperty("stats");
      expect(data.stats).toHaveProperty("actors_count");
      expect(data.stats).toHaveProperty("artifacts_count");
      expect(typeof data.stats.actors_count).toBe("number");
      expect(typeof data.stats.artifacts_count).toBe("number");
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .get("/accounts/me")
        .set("X-App-Slug", user.app.slug);

      expectErrorResponse(response, 401);
    });

    it("requires app context", async () => {
      const response = await request(app)
        .get("/accounts/me")
        .set("X-Test-User-Id", user.account.clerk_id);

      expectErrorResponse(response, 400, "App context required");
    });
  });

  describe("PATCH /accounts/me", () => {
    it("updates account metadata", async () => {
      const response = await request(app)
        .patch("/accounts/me")
        .set(headers)
        .send({
          metadata: {
            preferences: { theme: "dark" },
            onboarding_completed: true
          }
        });

      const data = expectSuccessResponse(response);
      expect(data.metadata.preferences.theme).toBe("dark");
      expect(data.metadata.onboarding_completed).toBe(true);
    });

    it("validates metadata is object", async () => {
      const response = await request(app)
        .patch("/accounts/me")
        .set(headers)
        .send({
          metadata: "invalid"
        });

      expectValidationError(response, "metadata");
    });

    it("preserves existing metadata", async () => {
      // First update
      await request(app)
        .patch("/accounts/me")
        .set(headers)
        .send({
          metadata: { setting1: "value1" }
        });

      // Second update
      const response = await request(app)
        .patch("/accounts/me")
        .set(headers)
        .send({
          metadata: { setting2: "value2" }
        });

      const data = expectSuccessResponse(response);
      expect(data.metadata.setting1).toBe("value1");
      expect(data.metadata.setting2).toBe("value2");
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .patch("/accounts/me")
        .set("X-App-Slug", user.app.slug)
        .send({ metadata: {} });

      expectErrorResponse(response, 401);
    });
  });

  describe("DELETE /accounts/me", () => {
    it("soft deletes account", async () => {
      const response = await request(app)
        .delete("/accounts/me")
        .set(headers);

      expectSuccessResponse(response);

      // Verify account is marked as deleted
      const { Account } = await import("#src/models/index.js");
      const account = await Account.query().findById(user.account.id);
      expect(account.metadata.deleted_at).toBeDefined();
      expect(account.metadata.deletion_reason).toBe("user_requested");
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .delete("/accounts/me")
        .set("X-App-Slug", user.app.slug);

      expectErrorResponse(response, 401);
    });

    it("prevents access after deletion", async () => {
      // Delete account
      await request(app)
        .delete("/accounts/me")
        .set(headers);

      // Try to access
      const response = await request(app)
        .get("/accounts/me")
        .set(headers);

      expectErrorResponse(response, 404, "Account not found");
    });
  });

  describe("Multi-tenant isolation", () => {
    it("isolates accounts by app", async () => {
      const otherUser = await createAuthenticatedUser({ appSlug: "other-app" });

      // Try to access account from different app
      const response = await request(app)
        .get("/accounts/me")
        .set({
          "X-App-Slug": "other-app",
          "X-Test-User-Id": user.account.clerk_id, // Same user, different app
        });

      expectErrorResponse(response, 404, "App not found");
    });
  });
});