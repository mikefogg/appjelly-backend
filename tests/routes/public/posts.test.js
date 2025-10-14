import { describe, it, expect, beforeEach, vi } from "vitest";
import app from "#src/index.js";
import { expectSuccessResponse, expectErrorResponse, expectPaginatedResponse, expectUnauthenticatedError, expectValidationError } from "../../helpers/assertions.js";
import {
  createTestContext,
  authenticatedRequest,
  unauthenticatedRequest,
} from "../../helpers/ghost-helpers.js";
import { Input, Artifact } from "#src/models/index.js";
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

describe("Posts Routes", () => {
  let context;

  beforeEach(async () => {
    context = await createTestContext();
    vi.clearAllMocks();
  });

  describe("POST /posts/generate", () => {
    it("generates post from prompt", async () => {
      const response = await authenticatedRequest(app, "post", "/posts/generate")
        .send({
          prompt: "Share thoughts on AI in 2025",
          connected_account_id: context.connectedAccount.id,
        });

      const data = expectSuccessResponse(response, 202);
      expect(data.status).toBe("pending");
      expect(data.message).toContain("queued");
      expect(data).toHaveProperty("id");
      expect(data.input).toHaveProperty("prompt", "Share thoughts on AI in 2025");

      // Verify input was created
      const input = await Input.query().findById(data.input.id);
      expect(input).toBeTruthy();
      expect(input.prompt).toBe("Share thoughts on AI in 2025");

      // Verify artifact was created
      const artifact = await Artifact.query().findById(data.id);
      expect(artifact).toBeTruthy();
      expect(artifact.status).toBe("pending");
      expect(artifact.artifact_type).toBe("social_post");

      // Verify job was queued
      expect(ghostQueue.add).toHaveBeenCalledWith(
        "generate-post",
        expect.objectContaining({
          artifactId: data.id,
        })
      );
    });

    it("validates prompt length", async () => {
      const response = await authenticatedRequest(app, "post", "/posts/generate")
        .send({
          prompt: "", // Empty prompt
          connected_account_id: context.connectedAccount.id,
        });

      expectValidationError(response, "prompt");
    });

    it("validates prompt max length", async () => {
      const response = await authenticatedRequest(app, "post", "/posts/generate")
        .send({
          prompt: "a".repeat(501), // Too long
          connected_account_id: context.connectedAccount.id,
        });

      expectValidationError(response, "prompt");
    });

    it("requires connected_account_id", async () => {
      const response = await authenticatedRequest(app, "post", "/posts/generate")
        .send({
          prompt: "Test prompt",
        });

      expectValidationError(response, "connected_account_id");
    });

    it("returns 404 for non-existent connected account", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "post", "/posts/generate")
        .send({
          prompt: "Test prompt",
          connected_account_id: fakeId,
        });

      expectErrorResponse(response, 404, "not found");
    });

    it("requires connection to be ready", async () => {
      // Set sync status to pending
      await context.connectedAccount.$query().patch({ sync_status: "pending" });

      const response = await authenticatedRequest(app, "post", "/posts/generate")
        .send({
          prompt: "Test prompt",
          connected_account_id: context.connectedAccount.id,
        });

      expectErrorResponse(response, 400, "not ready");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "post", "/posts/generate")
        .send({
          prompt: "Test prompt",
          connected_account_id: context.connectedAccount.id,
        });

      expectUnauthenticatedError(response);
    });
  });

  describe("GET /posts", () => {
    let artifacts;

    beforeEach(async () => {
      // Create some posts
      const input = await Input.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        prompt: "Test prompt",
      });

      artifacts = await Promise.all([
        Artifact.query().insert({
          input_id: input.id,
          account_id: context.account.id,
          app_id: context.app.id,
          connected_account_id: context.connectedAccount.id,
          artifact_type: "social_post",
          status: "completed",
          content: "Generated post content 1",
        }),
        Artifact.query().insert({
          input_id: input.id,
          account_id: context.account.id,
          app_id: context.app.id,
          connected_account_id: context.connectedAccount.id,
          artifact_type: "social_post",
          status: "completed",
          content: "Generated post content 2",
        }),
      ]);
    });

    it("returns paginated list of posts", async () => {
      const response = await authenticatedRequest(app, "get", "/posts");

      const data = expectPaginatedResponse(response);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("status");
      expect(data[0]).toHaveProperty("content");
      expect(data[0]).toHaveProperty("character_count");
      expect(data[0]).toHaveProperty("input");
      expect(data[0]).toHaveProperty("connected_account");
      expect(response.body.meta.pagination).toHaveProperty("page");
      expect(response.body.meta.pagination).toHaveProperty("per_page");
      expect(response.body.meta).toHaveProperty("total");
    });

    it("filters by connected_account_id", async () => {
      // Create another connected account with posts
      const otherContext = await createTestContext({ userId: "user_other456" });
      const otherInput = await Input.query().insert({
        account_id: otherContext.account.id,
        app_id: otherContext.app.id,
        connected_account_id: otherContext.connectedAccount.id,
        prompt: "Other prompt",
      });
      await Artifact.query().insert({
        input_id: otherInput.id,
        account_id: otherContext.account.id,
        app_id: otherContext.app.id,
        connected_account_id: otherContext.connectedAccount.id,
        artifact_type: "social_post",
        status: "completed",
        content: "Other post",
      });

      const response = await authenticatedRequest(app, "get", "/posts")
        .query({ connected_account_id: context.connectedAccount.id });

      const data = expectPaginatedResponse(response);
      expect(data.length).toBe(2); // Only our posts
      data.forEach(post => {
        expect(post.connected_account.id).toBe(context.connectedAccount.id);
      });
    });

    it("supports pagination", async () => {
      const response = await authenticatedRequest(app, "get", "/posts")
        .query({ page: 1, per_page: 1 });

      const data = expectPaginatedResponse(response);
      expect(data.length).toBe(1);
      expect(response.body.meta.pagination.per_page).toBe(1);
      expect(response.body.meta.pagination.has_more).toBe(true);
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "get", "/posts");
      expectUnauthenticatedError(response);
    });
  });

  describe("GET /posts/:id", () => {
    let post;

    beforeEach(async () => {
      const input = await Input.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        prompt: "Test prompt",
      });

      post = await Artifact.query().insert({
        input_id: input.id,
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        artifact_type: "social_post",
        status: "completed",
        content: "Generated post content",
        total_tokens: 150,
        cost_usd: 0.0001,
        ai_model: "gpt-4o-mini",
      });
    });

    it("returns post details with generation info", async () => {
      const response = await authenticatedRequest(app, "get", `/posts/${post.id}`);

      const data = expectSuccessResponse(response);
      expect(data.id).toBe(post.id);
      expect(data.status).toBe("completed");
      expect(data.content).toBe("Generated post content");
      expect(data.character_count).toBeGreaterThan(0);
      expect(data).toHaveProperty("input");
      expect(data).toHaveProperty("connected_account");
      expect(data).toHaveProperty("generation_info");
      expect(data.generation_info).toHaveProperty("total_tokens", 150);
      expect(data.generation_info).toHaveProperty("cost_usd");
      expect(data.generation_info).toHaveProperty("ai_model", "gpt-4o-mini");
    });

    it("returns 404 for non-existent post", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "get", `/posts/${fakeId}`);

      expectErrorResponse(response, 404, "not found");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "get", `/posts/${post.id}`);
      expectUnauthenticatedError(response);
    });
  });

  describe("PATCH /posts/:id", () => {
    let post;

    beforeEach(async () => {
      const input = await Input.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        prompt: "Test prompt",
      });

      post = await Artifact.query().insert({
        input_id: input.id,
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        artifact_type: "social_post",
        status: "completed",
        content: "Original content",
      });
    });

    it("updates post content", async () => {
      const newContent = "Updated content with changes";

      const response = await authenticatedRequest(app, "patch", `/posts/${post.id}`)
        .send({ content: newContent });

      const data = expectSuccessResponse(response);
      expect(data.content).toBe(newContent);
      expect(data.message).toContain("updated");

      // Verify in database
      const updated = await post.$query();
      expect(updated.content).toBe(newContent);
      expect(updated.metadata.edited).toBe(true);
      expect(updated.metadata).toHaveProperty("edited_at");
    });

    it("validates content length", async () => {
      const response = await authenticatedRequest(app, "patch", `/posts/${post.id}`)
        .send({ content: "" });

      expectValidationError(response, "content");
    });

    it("validates content max length", async () => {
      const response = await authenticatedRequest(app, "patch", `/posts/${post.id}`)
        .send({ content: "a".repeat(5001) });

      expectValidationError(response, "content");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "patch", `/posts/${post.id}`)
        .send({ content: "New content" });

      expectUnauthenticatedError(response);
    });
  });

  describe("POST /posts/:id/copy", () => {
    let post;

    beforeEach(async () => {
      const input = await Input.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        prompt: "Test prompt",
      });

      post = await Artifact.query().insert({
        input_id: input.id,
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        artifact_type: "social_post",
        status: "completed",
        content: "Post content",
      });
    });

    it("marks post as copied", async () => {
      const response = await authenticatedRequest(app, "post", `/posts/${post.id}/copy`);

      const data = expectSuccessResponse(response);
      expect(data.message).toContain("copied");

      // Verify in database
      const updated = await post.$query();
      expect(updated.metadata.copied).toBe(true);
      expect(updated.metadata).toHaveProperty("copied_at");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "post", `/posts/${post.id}/copy`);
      expectUnauthenticatedError(response);
    });
  });

  describe("DELETE /posts/:id", () => {
    let post;

    beforeEach(async () => {
      const input = await Input.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        prompt: "Test prompt",
      });

      post = await Artifact.query().insert({
        input_id: input.id,
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        artifact_type: "social_post",
        status: "completed",
        content: "Post content",
      });
    });

    it("deletes post", async () => {
      const response = await authenticatedRequest(app, "delete", `/posts/${post.id}`);

      const data = expectSuccessResponse(response);
      expect(data.message).toContain("deleted");

      // Verify deleted from database
      const deleted = await Artifact.query().findById(post.id);
      expect(deleted).toBeUndefined();
    });

    it("returns 404 for non-existent post", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "delete", `/posts/${fakeId}`);

      expectErrorResponse(response, 404, "not found");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "delete", `/posts/${post.id}`);
      expectUnauthenticatedError(response);
    });
  });

  describe("POST /posts/drafts", () => {
    it("creates a user-written draft", async () => {
      const response = await authenticatedRequest(app, "post", "/posts/drafts")
        .send({
          content: "This is my draft post that I wrote myself",
          connected_account_id: context.connectedAccount.id,
        });

      const data = expectSuccessResponse(response, 201);
      expect(data.status).toBe("draft");
      expect(data.content).toBe("This is my draft post that I wrote myself");
      expect(data.character_count).toBe(41);
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("connected_account");
      expect(data.connected_account.id).toBe(context.connectedAccount.id);

      // Verify draft was created in database
      const draft = await Artifact.query().findById(data.id);
      expect(draft).toBeTruthy();
      expect(draft.status).toBe("draft");
      expect(draft.input_id).toBeNull(); // Drafts have no input_id
      expect(draft.artifact_type).toBe("social_post");
      expect(draft.metadata.source).toBe("user");
    });

    it("validates content is required", async () => {
      const response = await authenticatedRequest(app, "post", "/posts/drafts")
        .send({
          connected_account_id: context.connectedAccount.id,
        });

      expectValidationError(response, "content");
    });

    it("validates content min length", async () => {
      const response = await authenticatedRequest(app, "post", "/posts/drafts")
        .send({
          content: "",
          connected_account_id: context.connectedAccount.id,
        });

      expectValidationError(response, "content");
    });

    it("validates content max length", async () => {
      const response = await authenticatedRequest(app, "post", "/posts/drafts")
        .send({
          content: "a".repeat(5001),
          connected_account_id: context.connectedAccount.id,
        });

      expectValidationError(response, "content");
    });

    it("requires connected_account_id", async () => {
      const response = await authenticatedRequest(app, "post", "/posts/drafts")
        .send({
          content: "Draft content",
        });

      expectValidationError(response, "connected_account_id");
    });

    it("returns 404 for non-existent connected account", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "post", "/posts/drafts")
        .send({
          content: "Draft content",
          connected_account_id: fakeId,
        });

      expectErrorResponse(response, 404, "not found");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "post", "/posts/drafts")
        .send({
          content: "Draft content",
          connected_account_id: context.connectedAccount.id,
        });

      expectUnauthenticatedError(response);
    });
  });

  describe("GET /posts with type filtering", () => {
    let draft, generatedPost;

    beforeEach(async () => {
      // Create a draft (no input_id)
      draft = await Artifact.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        artifact_type: "social_post",
        status: "draft",
        content: "User-written draft",
        metadata: { source: "user" },
      });

      // Create a generated post (with input_id)
      const input = await Input.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        prompt: "AI prompt",
      });

      generatedPost = await Artifact.query().insert({
        input_id: input.id,
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        artifact_type: "social_post",
        status: "completed",
        content: "AI-generated post",
      });
    });

    it("returns all posts by default", async () => {
      const response = await authenticatedRequest(app, "get", "/posts");

      const data = expectPaginatedResponse(response);
      expect(data.length).toBeGreaterThanOrEqual(2);

      // Should include both drafts and generated posts
      const hasDraft = data.some(p => p.is_draft === true);
      const hasGenerated = data.some(p => p.is_draft === false);
      expect(hasDraft).toBe(true);
      expect(hasGenerated).toBe(true);
    });

    it("filters to drafts only with type=draft", async () => {
      const response = await authenticatedRequest(app, "get", "/posts")
        .query({ type: "draft" });

      const data = expectPaginatedResponse(response);
      expect(data.length).toBeGreaterThanOrEqual(1);

      // All posts should be drafts
      data.forEach(post => {
        expect(post.is_draft).toBe(true);
        expect(post.input).toBeNull();
      });
    });

    it("filters to generated posts only with type=generated", async () => {
      const response = await authenticatedRequest(app, "get", "/posts")
        .query({ type: "generated" });

      const data = expectPaginatedResponse(response);
      expect(data.length).toBeGreaterThanOrEqual(1);

      // All posts should be generated (have input)
      data.forEach(post => {
        expect(post.is_draft).toBe(false);
        expect(post.input).not.toBeNull();
        expect(post.input).toHaveProperty("id");
        expect(post.input).toHaveProperty("prompt");
      });
    });

    it("returns all posts with type=all", async () => {
      const response = await authenticatedRequest(app, "get", "/posts")
        .query({ type: "all" });

      const data = expectPaginatedResponse(response);
      expect(data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("POST /posts/:id/improve", () => {
    let draft;

    beforeEach(async () => {
      draft = await Artifact.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        artifact_type: "social_post",
        status: "draft",
        content: "Original draft content that needs improvement",
        metadata: { source: "user" },
      });
    });

    it("returns AI improvement without saving to database", async () => {
      const response = await authenticatedRequest(app, "post", `/posts/${draft.id}/improve`)
        .send({
          instructions: "Make it more engaging and add emojis",
        });

      const data = expectSuccessResponse(response);

      // Should return both original and improved versions
      expect(data).toHaveProperty("original");
      expect(data.original.content).toBe(draft.content);
      expect(data.original.character_count).toBe(draft.content.length);

      expect(data).toHaveProperty("improved");
      expect(data.improved.content).toBeTruthy();
      expect(data.improved.character_count).toBeGreaterThan(0);
      expect(data.improved.content).not.toBe(draft.content); // Should be different

      expect(data.instructions).toBe("Make it more engaging and add emojis");
      expect(data).toHaveProperty("generation_info");
      expect(data.generation_info).toHaveProperty("total_tokens");
      expect(data.generation_info).toHaveProperty("cost_usd");
      expect(data.generation_info).toHaveProperty("ai_model");
      expect(data.message).toContain("PATCH");

      // Verify database was NOT modified
      const unchanged = await Artifact.query().findById(draft.id);
      expect(unchanged.content).toBe(draft.content); // Still original
    });

    it("works without instructions", async () => {
      const response = await authenticatedRequest(app, "post", `/posts/${draft.id}/improve`)
        .send({});

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("original");
      expect(data).toHaveProperty("improved");
      expect(data.instructions).toBeNull();
    });

    it("validates instructions max length", async () => {
      const response = await authenticatedRequest(app, "post", `/posts/${draft.id}/improve`)
        .send({
          instructions: "a".repeat(201),
        });

      expectValidationError(response, "instructions");
    });

    it("returns 404 for non-existent post", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "post", `/posts/${fakeId}/improve`)
        .send({});

      expectErrorResponse(response, 404, "not found");
    });

    it("returns 400 for post without content", async () => {
      const emptyPost = await Artifact.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        artifact_type: "social_post",
        status: "draft",
        content: null,
      });

      const response = await authenticatedRequest(app, "post", `/posts/${emptyPost.id}/improve`)
        .send({});

      expectErrorResponse(response, 400, "no content");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "post", `/posts/${draft.id}/improve`)
        .send({});

      expectUnauthenticatedError(response);
    });

    it("can improve generated posts too", async () => {
      // Create a generated post
      const input = await Input.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        prompt: "Test prompt",
      });

      const generatedPost = await Artifact.query().insert({
        input_id: input.id,
        account_id: context.account.id,
        app_id: context.app.id,
        connected_account_id: context.connectedAccount.id,
        artifact_type: "social_post",
        status: "completed",
        content: "Generated content",
      });

      const response = await authenticatedRequest(app, "post", `/posts/${generatedPost.id}/improve`)
        .send({
          instructions: "Make it shorter",
        });

      const data = expectSuccessResponse(response);
      expect(data.original.content).toBe("Generated content");
      expect(data).toHaveProperty("improved");
    });
  });
});
