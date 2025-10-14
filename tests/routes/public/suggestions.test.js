import { describe, it, expect, beforeEach, vi } from "vitest";
import app from "#src/index.js";
import { expectSuccessResponse, expectErrorResponse, expectUnauthenticatedError, expectValidationError } from "../../helpers/assertions.js";
import {
  createTestContext,
  createPostSuggestions,
  createNetworkProfiles,
  createNetworkPosts,
  authenticatedRequest,
  unauthenticatedRequest,
} from "../../helpers/ghost-helpers.js";
import { ghostQueue } from "#src/background/queues/index.js";

// Mock the queue
vi.mock("#src/background/queues/index.js", async () => {
  const actual = await vi.importActual("#src/background/queues/index.js");
  return {
    ...actual,
    ghostQueue: {
      add: vi.fn().mockResolvedValue({ id: "job_123" }),
    },
  };
});

describe("Suggestions Routes", () => {
  let context;
  let suggestions;

  beforeEach(async () => {
    context = await createTestContext();
    suggestions = await createPostSuggestions(
      context.account,
      context.connectedAccount,
      context.app
    );
    vi.clearAllMocks();
  });

  describe("GET /suggestions", () => {
    it("returns active suggestions for connected account", async () => {
      const response = await authenticatedRequest(app, "get", "/suggestions")
        .query({ connected_account_id: context.connectedAccount.id });

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("suggestion_type");
      expect(data[0]).toHaveProperty("content");
      expect(data[0]).toHaveProperty("reasoning");
      expect(data[0]).toHaveProperty("character_count");
      expect(data[0]).toHaveProperty("topics");
    });

    it("filters out expired suggestions", async () => {
      // Create an expired suggestion with all required fields
      const { PostSuggestion } = await import("#src/models/index.js");
      const expired = await PostSuggestion.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        suggestion_type: "original_post",
        content: "Expired suggestion",
        reasoning: "Test",
        status: "pending",
        expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
      });

      const response = await authenticatedRequest(app, "get", "/suggestions")
        .query({ connected_account_id: context.connectedAccount.id });

      const data = expectSuccessResponse(response);
      const expiredIds = data.map(s => s.id);
      expect(expiredIds).not.toContain(expired.id);
    });

    it("requires connected_account_id parameter", async () => {
      const response = await authenticatedRequest(app, "get", "/suggestions");

      expectValidationError(response, "connected_account_id");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "get", "/suggestions")
        .query({ connected_account_id: context.connectedAccount.id });

      expectUnauthenticatedError(response);
    });

    it("returns 404 for non-existent connected account", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "get", "/suggestions")
        .query({ connected_account_id: fakeId });

      expectErrorResponse(response, 404, "not found");
    });
  });

  describe("GET /suggestions/:id", () => {
    it("returns suggestion details", async () => {
      const response = await authenticatedRequest(
        app,
        "get",
        `/suggestions/${suggestions[0].id}`
      );

      const data = expectSuccessResponse(response);
      expect(data.id).toBe(suggestions[0].id);
      expect(data).toHaveProperty("suggestion_type");
      expect(data).toHaveProperty("content");
      expect(data).toHaveProperty("reasoning");
      expect(data).toHaveProperty("status");
      expect(data).toHaveProperty("connected_account");
      expect(data.connected_account).toHaveProperty("platform");
      expect(data.connected_account).toHaveProperty("username");
    });

    it("returns 404 for non-existent suggestion", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "get", `/suggestions/${fakeId}`);

      expectErrorResponse(response, 404, "not found");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "get",
        `/suggestions/${suggestions[0].id}`
      );
      expectUnauthenticatedError(response);
    });
  });

  describe("POST /suggestions/:id/use", () => {
    it("marks suggestion as used", async () => {
      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestions[0].id}/use`
      );

      const data = expectSuccessResponse(response);
      expect(data.message).toContain("used");
      expect(data.status).toBe("used");

      // Verify in database
      const updated = await suggestions[0].$query();
      expect(updated.status).toBe("used");
    });

    it("returns error if suggestion already used", async () => {
      // Mark as used first
      await suggestions[0].$query().patch({ status: "used" });

      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestions[0].id}/use`
      );

      expectErrorResponse(response, 400, "already been used");
    });

    it("returns 404 for non-existent suggestion", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "post", `/suggestions/${fakeId}/use`);

      expectErrorResponse(response, 404, "not found");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestions[0].id}/use`
      );
      expectUnauthenticatedError(response);
    });
  });

  describe("POST /suggestions/:id/dismiss", () => {
    it("marks suggestion as dismissed", async () => {
      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestions[0].id}/dismiss`
      );

      const data = expectSuccessResponse(response);
      expect(data.message).toContain("dismissed");
      expect(data.status).toBe("dismissed");

      // Verify in database
      const updated = await suggestions[0].$query();
      expect(updated.status).toBe("dismissed");
    });

    it("returns error if suggestion already dismissed", async () => {
      // Mark as dismissed first
      await suggestions[0].$query().patch({ status: "dismissed" });

      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestions[0].id}/dismiss`
      );

      expectErrorResponse(response, 400, "already been used");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestions[0].id}/dismiss`
      );
      expectUnauthenticatedError(response);
    });
  });

  describe("POST /suggestions/generate", () => {
    it("triggers suggestion generation job", async () => {
      const response = await authenticatedRequest(app, "post", "/suggestions/generate")
        .send({ connected_account_id: context.connectedAccount.id });

      const data = expectSuccessResponse(response, 202);
      expect(data.message).toContain("queued");

      // Verify job was queued
      expect(ghostQueue.add).toHaveBeenCalledWith(
        "generate-suggestions",
        expect.objectContaining({
          connectedAccountId: context.connectedAccount.id,
          suggestionCount: 3,
        })
      );
    });

    it("requires connected account to be synced", async () => {
      // Set sync status to pending
      await context.connectedAccount.$query().patch({ sync_status: "pending" });

      const response = await authenticatedRequest(app, "post", "/suggestions/generate")
        .send({ connected_account_id: context.connectedAccount.id });

      expectErrorResponse(response, 400, "must be synced");
    });

    it("requires connected_account_id in body", async () => {
      const response = await authenticatedRequest(app, "post", "/suggestions/generate")
        .send({});

      expectValidationError(response, "connected_account_id");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "post", "/suggestions/generate")
        .send({ connected_account_id: context.connectedAccount.id });

      expectUnauthenticatedError(response);
    });
  });

  describe("POST /suggestions/:id/regenerate", () => {
    it("returns 501 not implemented", async () => {
      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestions[0].id}/regenerate`
      );

      expectErrorResponse(response, 501, "not yet implemented");
    });
  });
});
