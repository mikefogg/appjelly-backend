import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "#src/index.js";
import { createAuthenticatedUser, createActor, createInput, createArtifact } from "../../helpers/mock-data.js";
import { expectSuccessResponse, expectErrorResponse, expectPaginatedResponse } from "../../helpers/assertions.js";


// Mock external dependencies only - not internal services

describe("Artifacts Routes", () => {
  let user;
  let headers;
  let actor;
  let input;

  beforeEach(async () => {
    user = await createAuthenticatedUser();
    headers = {
      "X-App-Slug": user.app.slug,
      "X-Test-User-Id": user.account.clerk_id,
    };

    actor = await createActor(user.account, { name: "Emma" });
    input = await createInput(user.account, [actor], { 
      prompt: "A magical adventure in the backyard" 
    });
  });

  describe("GET /artifacts", () => {
    it("returns user's artifacts", async () => {
      const artifact1 = await createArtifact(input, { title: "Story 1" });
      const artifact2 = await createArtifact(input, { title: "Story 2" });

      const response = await request(app)
        .get("/artifacts")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(2);
      expect(data[0]).toHaveProperty("title");
      expect(data[0]).toHaveProperty("artifact_type");
      expect(data.map(a => a.id)).toContain(artifact1.id);
      expect(data.map(a => a.id)).toContain(artifact2.id);
    });

    it("filters by artifact type", async () => {
      await createArtifact(input, { artifact_type: "story" });
      await createArtifact(input, { artifact_type: "image" });

      const response = await request(app)
        .get("/artifacts?type=story")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(1);
      expect(data[0].artifact_type).toBe("story");
    });

    it("supports pagination", async () => {
      // Create multiple artifacts
      for (let i = 0; i < 15; i++) {
        await createArtifact(input, { title: `Story ${i}` });
      }

      const response = await request(app)
        .get("/artifacts?per_page=5")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(5);
      expect(response.body.meta.total).toBe(15);
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .get("/artifacts")
        .set("X-App-Slug", user.app.slug);

      expectErrorResponse(response, 401);
    });
  });

  describe("GET /artifacts/:id", () => {
    it("returns artifact details", async () => {
      const artifact = await createArtifact(input, { title: "Test Story" });

      const response = await request(app)
        .get(`/artifacts/${artifact.id}`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.id).toBe(artifact.id);
      expect(data.title).toBe("Test Story");
      expect(data).toHaveProperty("input");
      expect(data.input.prompt).toBe(input.prompt);
    });

    it("returns 404 for non-existent artifact", async () => {
      const response = await request(app)
        .get("/artifacts/123e4567-e89b-12d3-a456-426614174000")
        .set(headers);

      expectErrorResponse(response, 404, "Artifact not found");
    });

    it("returns 404 for artifact from different account", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);
      const otherInput = await createInput(otherUser.account, [otherActor]);
      const otherArtifact = await createArtifact(otherInput);

      const response = await request(app)
        .get(`/artifacts/${otherArtifact.id}`)
        .set(headers);

      expectErrorResponse(response, 404, "Artifact not found");
    });
  });

  describe("GET /artifacts/:id/pages", () => {
    it("returns artifact pages", async () => {
      const artifact = await createArtifact(input);
      
      // Create artifact pages
      const { ArtifactPage } = await import("#src/models/index.js");
      await ArtifactPage.query().insert([
        {
          artifact_id: artifact.id,
          page_number: 1,
          text: "Once upon a time...",
          image_key: "img_page1",
          layout_data: {}
        },
        {
          artifact_id: artifact.id,
          page_number: 2,
          text: "And they lived happily ever after.",
          image_key: "img_page2",
          layout_data: {}
        }
      ]);

      const response = await request(app)
        .get(`/artifacts/${artifact.id}/pages`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0].page_number).toBe(1);
      expect(data[1].page_number).toBe(2);
      expect(data[0]).toHaveProperty("text");
      expect(data[0]).toHaveProperty("image_url");
    });

    it("returns empty array for artifact with no pages", async () => {
      const artifact = await createArtifact(input);

      const response = await request(app)
        .get(`/artifacts/${artifact.id}/pages`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    });
  });

  describe("GET /artifacts/:id/pages/:pageNum", () => {
    it("returns specific page content", async () => {
      const artifact = await createArtifact(input);
      
      const { ArtifactPage } = await import("#src/models/index.js");
      await ArtifactPage.query().insert({
        artifact_id: artifact.id,
        page_number: 1,
        text: "Once upon a time...",
        image_key: "img_page1",
        layout_data: { style: "full-page" }
      });

      const response = await request(app)
        .get(`/artifacts/${artifact.id}/pages/1`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.page_number).toBe(1);
      expect(data.text).toBe("Once upon a time...");
      expect(data.layout_data.style).toBe("full-page");
    });

    it("returns 404 for non-existent page", async () => {
      const artifact = await createArtifact(input);

      const response = await request(app)
        .get(`/artifacts/${artifact.id}/pages/999`)
        .set(headers);

      expectErrorResponse(response, 404, "Page not found");
    });
  });

  describe("POST /artifacts/:id/regenerate", () => {
    it("queues artifact regeneration", async () => {
      const artifact = await createArtifact(input);

      const response = await request(app)
        .post(`/artifacts/${artifact.id}/regenerate`)
        .set(headers)
        .send({
          regenerate_images: true,
          style_updates: { tone: "exciting" }
        });

      const data = expectSuccessResponse(response);
      expect(data.artifact_id).toBe(artifact.id);
      expect(data.status).toBe("regenerating");
    });

    it("validates regeneration options", async () => {
      const artifact = await createArtifact(input);

      const response = await request(app)
        .post(`/artifacts/${artifact.id}/regenerate`)
        .set(headers)
        .send({
          regenerate_images: "invalid" // Should be boolean
        });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("errors");
      expect(response.body.errors).toHaveProperty("regenerate_images");
    });
  });

  describe("DELETE /artifacts/:id", () => {
    it("deletes artifact", async () => {
      const artifact = await createArtifact(input);

      const response = await request(app)
        .delete(`/artifacts/${artifact.id}`)
        .set(headers);

      expectSuccessResponse(response);

      // Verify deletion
      const getResponse = await request(app)
        .get(`/artifacts/${artifact.id}`)
        .set(headers);

      expectErrorResponse(getResponse, 404);
    });

    it("prevents deleting artifact from different account", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);
      const otherInput = await createInput(otherUser.account, [otherActor]);
      const otherArtifact = await createArtifact(otherInput);

      const response = await request(app)
        .delete(`/artifacts/${otherArtifact.id}`)
        .set(headers);

      expectErrorResponse(response, 404, "Artifact not found");
    });
  });

  describe("Multi-tenant isolation", () => {
    it("only returns artifacts for current app", async () => {
      const otherUser = await createAuthenticatedUser({ appSlug: "other-app" });
      const otherActor = await createActor(otherUser.account);
      const otherInput = await createInput(otherUser.account, [otherActor]);
      
      await createArtifact(input, { title: "MyStory" });
      await createArtifact(otherInput, { title: "OtherStory" });

      const response = await request(app)
        .get("/artifacts")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe("MyStory");
    });
  });

  describe("Business logic", () => {
    it("includes related input and actors in response", async () => {
      const artifact = await createArtifact(input);

      const response = await request(app)
        .get(`/artifacts/${artifact.id}`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.input).toHaveProperty("prompt");
      expect(data.input.actors).toHaveLength(1);
      expect(data.input.actors[0].name).toBe("Emma");
    });

    it("handles artifacts without pages gracefully", async () => {
      const artifact = await createArtifact(input, {
        metadata: { status: "generating" }
      });

      const response = await request(app)
        .get(`/artifacts/${artifact.id}`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.metadata.status).toBe("generating");
    });
  });
});