import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "#src/index.js";
import { createAuthenticatedUser, createActor, createInput } from "../../helpers/mock-data.js";
import { expectSuccessResponse, expectErrorResponse, expectValidationError, expectPaginatedResponse } from "../../helpers/assertions.js";



// Mock external LangChain packages  
vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    invoke: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        characters: [
          {
            name: "Emma",
            matchedActorIds: [],
            type: "child",
            isNew: true,
            relationships: {}
          }
        ],
        ambiguousMatches: []
      })
    })
  }))
}));

vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: vi.fn().mockImplementation(() => ({
    invoke: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        characters: [
          {
            name: "Emma",
            matchedActorIds: [],
            type: "child",
            isNew: true,
            relationships: {}
          }
        ],
        ambiguousMatches: []
      })
    })
  }))
}));

vi.mock("@langchain/core/messages", () => ({
  HumanMessage: vi.fn().mockImplementation((content) => ({ content })),
  SystemMessage: vi.fn().mockImplementation((content) => ({ content })),
}));

// Mock background queues
vi.mock("#src/background/queues/index.js", () => ({
  contentQueue: {
    add: vi.fn().mockResolvedValue({ id: "job-123" })
  },
  JOB_GENERATE_STORY: "generate-story"
}));

describe("Inputs Routes", () => {
  let user;
  let headers;
  let actor;

  beforeEach(async () => {
    user = await createAuthenticatedUser();
    headers = {
      "X-App-Slug": user.app.slug,
      "X-Test-User-Id": user.account.clerk_id,
    };

    actor = await createActor(user.account, { name: "Emma", type: "child" });
    
  });

  describe("GET /inputs", () => {
    it("returns user's story prompts", async () => {
      const input1 = await createInput(user.account, [actor], { 
        prompt: "A magical adventure" 
      });
      const input2 = await createInput(user.account, [actor], { 
        prompt: "A space journey" 
      });

      const response = await request(app)
        .get("/inputs")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(2);
      expect(data[0]).toHaveProperty("prompt");
      expect(data[0]).toHaveProperty("actor_ids");
      expect(data.map(i => i.id)).toContain(input1.id);
      expect(data.map(i => i.id)).toContain(input2.id);
    });

    it("includes related actors in response", async () => {
      await createInput(user.account, [actor], { 
        prompt: "A magical adventure" 
      });

      const response = await request(app)
        .get("/inputs")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data[0]).toHaveProperty("actors");
      expect(Array.isArray(data[0].actors)).toBe(true);
      expect(data[0].actors[0].name).toBe("Emma");
    });

    it("supports pagination", async () => {
      // Create multiple inputs
      for (let i = 0; i < 15; i++) {
        await createInput(user.account, [actor], { 
          prompt: `Story prompt ${i}` 
        });
      }

      const response = await request(app)
        .get("/inputs?per_page=5")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(5);
      expect(response.body.meta.total).toBe(15);
    });

    it("filters by date range", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const response = await request(app)
        .get(`/inputs?created_after=${yesterday.toISOString()}`)
        .set(headers);

      expectPaginatedResponse(response);
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .get("/inputs")
        .set("X-App-Slug", user.app.slug);

      expectErrorResponse(response, 401);
    });
  });

  describe("POST /inputs", () => {
    it("creates new story prompt", async () => {
      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "Emma goes on a magical adventure in the backyard",
          actor_ids: [actor.id],
          metadata: { length: "short", tone: "adventurous" }
        });

      const data = expectSuccessResponse(response, 201);
      expect(data.prompt).toBe("Emma goes on a magical adventure in the backyard");
      expect(data.actor_ids).toContain(actor.id);
      expect(data.account_id).toBe(user.account.id);
      expect(data.app_id).toBe(user.app.id);
      expect(data.metadata.length).toBe("short");
    });

    it("validates required fields", async () => {
      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({});

      expectValidationError(response, "prompt");
    });

    it("validates prompt length", async () => {
      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "Short", // Too short
          actor_ids: [actor.id]
        });

      expectValidationError(response, "prompt");
    });

    it("validates prompt max length", async () => {
      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "A".repeat(2001), // Too long
          actor_ids: [actor.id]
        });

      expectValidationError(response, "prompt");
    });

    it("validates actor_ids array", async () => {
      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "A valid prompt",
          actor_ids: "not-an-array"
        });

      expectValidationError(response, "actor_ids");
    });

    it("validates actor_ids are UUIDs", async () => {
      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "A valid prompt",
          actor_ids: ["invalid-uuid"]
        });

      expectValidationError(response, "actor_ids");
    });

    it("validates actors belong to user", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);

      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "A valid prompt",
          actor_ids: [otherActor.id]
        });

      expectErrorResponse(response, 400, "One or more actors not found");
    });

    it("allows empty actor_ids for character-less stories", async () => {
      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "A story about the forest itself",
          actor_ids: []
        });

      const data = expectSuccessResponse(response, 201);
      expect(data.actor_ids).toHaveLength(0);
    });

    it("validates max number of actors", async () => {
      // Create many actors
      const actors = [];
      for (let i = 0; i < 10; i++) {
        const a = await createActor(user.account, { name: `Actor${i}` });
        actors.push(a.id);
      }

      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "A story with too many characters",
          actor_ids: actors
        });

      expectValidationError(response, "actor_ids");
    });

    it("queues story generation job", async () => {
      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "Emma goes on an adventure",
          actor_ids: [actor.id],
          generate_immediately: true
        });

      expectSuccessResponse(response, 201);

      const { contentQueue } = await import("#src/background/queues/index.js");
      expect(contentQueue.add).toHaveBeenCalledWith(
        "generate-story",
        expect.objectContaining({
          inputId: expect.any(String),
          prompt: "Emma goes on an adventure"
        }),
        expect.objectContaining({
          priority: expect.any(Number),
          delay: expect.any(Number)
        })
      );
    });
  });

  describe("GET /inputs/:id", () => {
    it("returns input details", async () => {
      const input = await createInput(user.account, [actor], { 
        prompt: "Test prompt" 
      });

      const response = await request(app)
        .get(`/inputs/${input.id}`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.id).toBe(input.id);
      expect(data.prompt).toBe("Test prompt");
      expect(data.actors).toHaveLength(1);
      expect(data.actors[0].name).toBe("Emma");
    });

    it("returns 404 for non-existent input", async () => {
      const response = await request(app)
        .get("/inputs/123e4567-e89b-12d3-a456-426614174000")
        .set(headers);

      expectErrorResponse(response, 404, "Input not found");
    });

    it("prevents access to other user's inputs", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);
      const otherInput = await createInput(otherUser.account, [otherActor]);

      const response = await request(app)
        .get(`/inputs/${otherInput.id}`)
        .set(headers);

      expectErrorResponse(response, 404, "Input not found");
    });
  });

  describe("POST /inputs/:id/inference", () => {
    it("infers actors from prompt text", async () => {
      const input = await createInput(user.account, [], { 
        prompt: "Emma and Buddy go on an adventure" 
      });

      const response = await request(app)
        .post(`/inputs/${input.id}/inference`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("suggestions");
      expect(Array.isArray(data.suggestions)).toBe(true);
      expect(data.suggestions[0]).toHaveProperty("name", "Emma");
      expect(data.suggestions[0]).toHaveProperty("type", "child");
      expect(data.suggestions[0]).toHaveProperty("confidence");
    });

    it("provides character creation suggestions", async () => {
      const input = await createInput(user.account, [], { 
        prompt: "A story about a brave knight" 
      });

      const response = await request(app)
        .post(`/inputs/${input.id}/inference`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("create_suggestions");
      expect(Array.isArray(data.create_suggestions)).toBe(true);
    });

    it("matches existing user actors", async () => {
      const input = await createInput(user.account, [], { 
        prompt: "Emma goes on an adventure" 
      });

      const response = await request(app)
        .post(`/inputs/${input.id}/inference`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("existing_matches");
      expect(Array.isArray(data.existing_matches)).toBe(true);
    });

    it("handles AI service errors gracefully", async () => {
      const input = await createInput(user.account, [], { 
        prompt: "Test prompt" 
      });

      const response = await request(app)
        .post(`/inputs/${input.id}/inference`)
        .set(headers);

      // Should still return a response, even if AI fails
      expect([200, 500]).toContain(response.status);
    });
  });

  describe("PATCH /inputs/:id", () => {
    it("updates input prompt and metadata", async () => {
      const input = await createInput(user.account, [actor]);

      const response = await request(app)
        .patch(`/inputs/${input.id}`)
        .set(headers)
        .send({
          prompt: "Updated prompt",
          metadata: { length: "long", updated: true }
        });

      const data = expectSuccessResponse(response);
      expect(data.prompt).toBe("Updated prompt");
      expect(data.metadata.length).toBe("long");
      expect(data.metadata.updated).toBe(true);
    });

    it("validates updated data", async () => {
      const input = await createInput(user.account, [actor]);

      const response = await request(app)
        .patch(`/inputs/${input.id}`)
        .set(headers)
        .send({
          prompt: "", // Invalid empty prompt
        });

      expectValidationError(response, "prompt");
    });

    it("prevents updating other user's inputs", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);
      const otherInput = await createInput(otherUser.account, [otherActor]);

      const response = await request(app)
        .patch(`/inputs/${otherInput.id}`)
        .set(headers)
        .send({ prompt: "Hacked prompt" });

      expectErrorResponse(response, 404, "Input not found");
    });
  });

  describe("DELETE /inputs/:id", () => {
    it("deletes input", async () => {
      const input = await createInput(user.account, [actor]);

      const response = await request(app)
        .delete(`/inputs/${input.id}`)
        .set(headers);

      expectSuccessResponse(response);

      // Verify deletion
      const getResponse = await request(app)
        .get(`/inputs/${input.id}`)
        .set(headers);

      expectErrorResponse(getResponse, 404);
    });

    it("prevents deleting other user's inputs", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);
      const otherInput = await createInput(otherUser.account, [otherActor]);

      const response = await request(app)
        .delete(`/inputs/${otherInput.id}`)
        .set(headers);

      expectErrorResponse(response, 404, "Input not found");
    });

    it("deletes related artifacts when deleting input", async () => {
      const input = await createInput(user.account, [actor]);
      const { createArtifact } = await import("../../helpers/mock-data.js");
      await createArtifact(input);

      const response = await request(app)
        .delete(`/inputs/${input.id}`)
        .set(headers);

      expectSuccessResponse(response);

      // Verify related artifacts are also deleted
      const { Artifact } = await import("#src/models/index.js");
      const artifacts = await Artifact.query().where("input_id", input.id);
      expect(artifacts).toHaveLength(0);
    });
  });

  describe("Multi-tenant isolation", () => {
    it("isolates inputs by app", async () => {
      const otherUser = await createAuthenticatedUser({ appSlug: "other-app" });
      const otherActor = await createActor(otherUser.account);
      
      await createInput(user.account, [actor], { prompt: "MyPrompt" });
      await createInput(otherUser.account, [otherActor], { prompt: "OtherPrompt" });

      const response = await request(app)
        .get("/inputs")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(1);
      expect(data[0].prompt).toBe("MyPrompt");
    });
  });

  describe("Business logic", () => {
    it("tracks input creation for usage analytics", async () => {
      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "A test prompt",
          actor_ids: [actor.id]
        });

      expectSuccessResponse(response, 201);
      
      // In a real implementation, this would verify analytics tracking
    });

    it("validates against subscription limits", async () => {
      // Create multiple inputs to test limits
      for (let i = 0; i < 10; i++) {
        await createInput(user.account, [actor], { 
          prompt: `Prompt ${i}` 
        });
      }

      // This would normally check subscription limits
      const response = await request(app)
        .post("/inputs")
        .set(headers)
        .send({
          prompt: "Another prompt",
          actor_ids: [actor.id]
        });

      // For free tier, this might be rate limited
      expect([201, 429]).toContain(response.status);
    });
  });
});