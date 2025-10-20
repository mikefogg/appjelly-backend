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

    it("returns all pending suggestions including expired ones", async () => {
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
      const returnedIds = data.map(s => s.id);
      // API returns all pending suggestions regardless of expiration
      expect(returnedIds).toContain(expired.id);
      // The expired suggestion should have expires_at in the response
      const expiredSuggestion = data.find(s => s.id === expired.id);
      expect(expiredSuggestion).toHaveProperty("expires_at");
      expect(new Date(expiredSuggestion.expires_at).getTime()).toBeLessThan(Date.now());
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

  describe("POST /suggestions/:id/generate-response", () => {
    let suggestionWithSource;
    let sourcePost;
    let networkProfile;

    beforeEach(async () => {
      // Create a network profile and source post for testing
      const { NetworkProfile, NetworkPost, PostSuggestion } = await import("#src/models/index.js");

      networkProfile = await NetworkProfile.query().insert({
        connected_account_id: context.connectedAccount.id,
        platform: "twitter",
        platform_user_id: "test_user_123",
        username: "testauthor",
        display_name: "Test Author",
        profile_data: {},
      });

      sourcePost = await NetworkPost.query().insert({
        connected_account_id: context.connectedAccount.id,
        network_profile_id: networkProfile.id,
        platform: "twitter",
        post_id: "post_123",
        content: "This is an interesting post about AI technology",
        posted_at: new Date().toISOString(),
        engagement_score: 150,
      });

      suggestionWithSource = await PostSuggestion.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        source_post_id: sourcePost.id,
        suggestion_type: "reply",
        content: "Great point about AI!",
        reasoning: "This is relevant to your interests",
        status: "pending",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    });

    it("generates AI response to source post", async () => {

      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestionWithSource.id}/generate-response`
      ).send({});

      const data = expectSuccessResponse(response, 202);
      expect(data.status).toBe("pending");
      expect(data.message).toContain("queued");
      expect(data).toHaveProperty("id"); // artifact ID
      expect(data).toHaveProperty("input");
      expect(data.input).toHaveProperty("prompt");
      expect(data).toHaveProperty("reply_to");
      expect(data.reply_to).toHaveProperty("post_id");
      expect(data.reply_to).toHaveProperty("author");
      expect(data.reply_to).toHaveProperty("content");

      // Verify job was queued
      expect(ghostQueue.add).toHaveBeenCalledWith(
        "generate-post",
        expect.objectContaining({
          artifactId: data.id,
        })
      );

      // Verify input was created
      const { Input } = await import("#src/models/index.js");
      const input = await Input.query().findById(data.input.id);
      expect(input).toBeTruthy();
      expect(input.prompt).toContain("Generate a reply");

      // Verify artifact was created
      const { Artifact } = await import("#src/models/index.js");
      const artifact = await Artifact.query().findById(data.id);
      expect(artifact).toBeTruthy();
      expect(artifact.status).toBe("pending");
      expect(artifact.metadata.is_reply).toBe(true);
      expect(artifact.metadata.reply_to_post_id).toBe(data.reply_to.post_id);
    });

    it("generates response with additional instructions", async () => {
      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestionWithSource.id}/generate-response`
      ).send({
        additional_instructions: "Make it funny and add a joke",
      });

      const data = expectSuccessResponse(response, 202);
      expect(data.status).toBe("pending");

      // Verify prompt includes instructions
      const { Input } = await import("#src/models/index.js");
      const input = await Input.query().findById(data.input.id);
      expect(input.prompt).toContain("Make it funny and add a joke");
    });

    it("validates additional_instructions max length", async () => {
      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestionWithSource.id}/generate-response`
      ).send({
        additional_instructions: "a".repeat(201), // Too long
      });

      expectValidationError(response, "additional_instructions");
    });

    it("returns 404 for non-existent suggestion", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${fakeId}/generate-response`
      ).send({});

      expectErrorResponse(response, 404, "not found");
    });

    it("returns 400 for suggestion without source post", async () => {
      // Create a suggestion without source_post_id
      const { PostSuggestion } = await import("#src/models/index.js");
      const suggestionNoSource = await PostSuggestion.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        suggestion_type: "original_post",
        content: "Standalone suggestion",
        reasoning: "Test",
        status: "pending",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestionNoSource.id}/generate-response`
      ).send({});

      expectErrorResponse(response, 400, "no source post");
    });

    it("requires connected account to be ready", async () => {
      // Set sync status to pending
      await context.connectedAccount.$query().patch({ sync_status: "pending" });

      const response = await authenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestionWithSource.id}/generate-response`
      ).send({});

      expectErrorResponse(response, 400, "not ready");

      // Reset for other tests
      await context.connectedAccount.$query().patch({ sync_status: "ready" });
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "post",
        `/suggestions/${suggestionWithSource.id}/generate-response`
      ).send({});

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
