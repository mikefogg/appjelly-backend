import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "#src/index.js";
import { createAuthenticatedUser, createActor, createMedia, createMediaSession } from "../../helpers/mock-data.js";
import { expectSuccessResponse, expectErrorResponse, expectValidationError, expectPaginatedResponse } from "../../helpers/assertions.js";


// Mock external AWS service
vi.mock("aws-sdk", () => ({
  default: {
    S3: vi.fn(() => ({
      getSignedUrlPromise: vi.fn(() => Promise.resolve("https://test-upload-url.com")),
      upload: vi.fn(() => ({
        promise: vi.fn(() => Promise.resolve({ Location: "https://test-image-url.com" }))
      })),
      deleteObject: vi.fn(() => ({
        promise: vi.fn(() => Promise.resolve({}))
      }))
    }))
  }
}));

// Mock external fetch for Cloudflare
global.fetch = vi.fn(() => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({
    result: {
      uploadURL: "https://test-upload-url.com",
      variants: ["https://test-image-url.com"]
    }
  })
}));


describe("Actors Routes", () => {
  let user;
  let headers;

  beforeEach(async () => {
    user = await createAuthenticatedUser();
    headers = {
      "X-App-Slug": user.app.slug,
      "X-Test-User-Id": user.account.clerk_id,
    };
  });

  describe("GET /actors", () => {
    it("returns user's actors", async () => {
      const actor1 = await createActor(user.account, { name: "Emma", type: "child" });
      const actor2 = await createActor(user.account, { name: "Buddy", type: "pet" });

      const response = await request(app)
        .get("/actors")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(2);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("type");
      expect(data.map(a => a.id)).toContain(actor1.id);
      expect(data.map(a => a.id)).toContain(actor2.id);
    });

    it("returns empty array when no actors", async () => {
      const response = await request(app)
        .get("/actors")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(0);
    });

    it("filters by type", async () => {
      await createActor(user.account, { name: "Emma", type: "child" });
      await createActor(user.account, { name: "Buddy", type: "pet" });

      const response = await request(app)
        .get("/actors?type=child")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(1);
      expect(data[0].type).toBe("child");
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .get("/actors")
        .set("X-App-Slug", user.app.slug);

      expectErrorResponse(response, 401);
    });

    it("requires app context", async () => {
      const response = await request(app)
        .get("/actors")
        .set("X-Test-User-Id", user.account.clerk_id);

      expectErrorResponse(response, 400, "App context required");
    });
  });

  describe("POST /actors", () => {
    it("creates new actor", async () => {
      const actorData = {
        name: "Emma",
        type: "child",
        metadata: { age: 8, traits: ["curious"] }
      };

      const response = await request(app)
        .post("/actors")
        .set(headers)
        .send(actorData);

      const data = expectSuccessResponse(response, 201);
      expect(data.name).toBe("Emma");
      expect(data.type).toBe("child");
      expect(data.account_id).toBe(user.account.id);
      expect(data.app_id).toBe(user.app.id);
      expect(data.metadata.age).toBe(8);
    });

    it("validates required fields", async () => {
      const response = await request(app)
        .post("/actors")
        .set(headers)
        .send({});

      expectValidationError(response, "name");
    });

    it("validates actor type", async () => {
      const response = await request(app)
        .post("/actors")
        .set(headers)
        .send({
          name: "Emma",
          type: "invalid_type"
        });

      expectValidationError(response, "type");
    });

    it("validates name length", async () => {
      const response = await request(app)
        .post("/actors")
        .set(headers)
        .send({
          name: "A".repeat(101), // Too long
          type: "child"
        });

      expectValidationError(response, "name");
    });

    it("validates metadata is object", async () => {
      const response = await request(app)
        .post("/actors")
        .set(headers)
        .send({
          name: "Emma",
          type: "child",
          metadata: "invalid"
        });

      expectValidationError(response, "metadata");
    });
  });

  describe("GET /actors/:id", () => {
    it("returns actor details", async () => {
      const actor = await createActor(user.account, { name: "Emma" });

      const response = await request(app)
        .get(`/actors/${actor.id}`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.id).toBe(actor.id);
      expect(data.name).toBe("Emma");
    });

    it("returns 404 for non-existent actor", async () => {
      const response = await request(app)
        .get("/actors/123e4567-e89b-12d3-a456-426614174000")
        .set(headers);

      expectErrorResponse(response, 404, "Actor not found");
    });

    it("returns 404 for actor from different account", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);

      const response = await request(app)
        .get(`/actors/${otherActor.id}`)
        .set(headers);

      expectErrorResponse(response, 404, "Actor not found");
    });
  });

  describe("PATCH /actors/:id", () => {
    it("updates actor", async () => {
      const actor = await createActor(user.account, { name: "Emma" });

      const response = await request(app)
        .patch(`/actors/${actor.id}`)
        .set(headers)
        .send({
          name: "Emma Updated",
          metadata: { age: 9 }
        });

      const data = expectSuccessResponse(response);
      expect(data.name).toBe("Emma Updated");
      expect(data.metadata.age).toBe(9);
    });

    it("validates update data", async () => {
      const actor = await createActor(user.account);

      const response = await request(app)
        .patch(`/actors/${actor.id}`)
        .set(headers)
        .send({
          name: "", // Invalid empty name
        });

      expectValidationError(response, "name");
    });

    it("prevents updating actor from different account", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);

      const response = await request(app)
        .patch(`/actors/${otherActor.id}`)
        .set(headers)
        .send({ name: "Hacked" });

      expectErrorResponse(response, 404, "Actor not found");
    });

    it("updates actor with upload session", async () => {
      const actor = await createActor(user.account, { name: "Emma" });
      const { sessionId } = await createMediaSession(user.account, 2);

      const response = await request(app)
        .patch(`/actors/${actor.id}`)
        .set(headers)
        .send({
          name: "Emma Updated",
          upload_session_id: sessionId
        });

      const data = expectSuccessResponse(response);
      expect(data.name).toBe("Emma Updated");
      expect(data.media).toHaveLength(2);
      
      // Verify media was properly committed to the actor
      expect(data.media.every(m => m.image_key.startsWith("cf_"))).toBe(true);
      expect(data.media.every(m => m.id)).toBeTruthy();
    });

    it("validates upload_session_id format", async () => {
      const actor = await createActor(user.account);

      const response = await request(app)
        .patch(`/actors/${actor.id}`)
        .set(headers)
        .send({
          name: "Updated",
          upload_session_id: "invalid-uuid"
        });

      expectValidationError(response, "upload_session_id");
    });

    it("returns 404 for non-existent upload session", async () => {
      const actor = await createActor(user.account);
      const fakeSessionId = "123e4567-e89b-12d3-a456-426614174000";

      const response = await request(app)
        .patch(`/actors/${actor.id}`)
        .set(headers)
        .send({
          name: "Updated",
          upload_session_id: fakeSessionId
        });

      expectErrorResponse(response, 404, "Upload session not found");
    });

    it("prevents using upload session from different user", async () => {
      const actor = await createActor(user.account);
      const otherUser = await createAuthenticatedUser();
      const { sessionId } = await createMediaSession(otherUser.account);

      const response = await request(app)
        .patch(`/actors/${actor.id}`)
        .set(headers)
        .send({
          name: "Updated",
          upload_session_id: sessionId
        });

      expectErrorResponse(response, 403, "Access denied");
    });

    it("enforces 10 image limit when updating with session", async () => {
      const actor = await createActor(user.account);
      
      // Create 8 existing media for actor
      for (let i = 0; i < 8; i++) {
        await createMedia(actor);
      }
      
      // Try to add 3 more (would exceed limit)
      const { sessionId } = await createMediaSession(user.account, 3);

      const response = await request(app)
        .patch(`/actors/${actor.id}`)
        .set(headers)
        .send({
          upload_session_id: sessionId
        });

      expectErrorResponse(response, 400, "Cannot add 3 images");
    });

    it("allows updating without upload session", async () => {
      const actor = await createActor(user.account, { name: "Emma" });

      const response = await request(app)
        .patch(`/actors/${actor.id}`)
        .set(headers)
        .send({
          name: "Emma Updated"
        });

      const data = expectSuccessResponse(response);
      expect(data.name).toBe("Emma Updated");
    });
  });

  describe("DELETE /actors/:id", () => {
    it("deletes actor", async () => {
      const actor = await createActor(user.account);

      const response = await request(app)
        .delete(`/actors/${actor.id}`)
        .set(headers);

      expectSuccessResponse(response);

      // Verify deletion
      const getResponse = await request(app)
        .get(`/actors/${actor.id}`)
        .set(headers);

      expectErrorResponse(getResponse, 404);
    });

    it("prevents deleting actor from different account", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);

      const response = await request(app)
        .delete(`/actors/${otherActor.id}`)
        .set(headers);

      expectErrorResponse(response, 404, "Actor not found");
    });
  });

  describe("POST /actors/:id/media", () => {
    it("generates upload URL for actor media", async () => {
      const actor = await createActor(user.account);

      const response = await request(app)
        .post(`/actors/${actor.id}/media`)
        .set(headers);

      const data = expectSuccessResponse(response, 201);
      expect(data).toHaveProperty("media_id");
      expect(data).toHaveProperty("image_key");
      expect(data).toHaveProperty("upload_url");
      expect(data).toHaveProperty("image_url");
      expect(typeof data.image_key).toBe("string");
      expect(data.image_key).toMatch(/^cf-/); // Cloudflare auto-generated ID
    });

    it("prevents uploading to actor from different account", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);

      const response = await request(app)
        .post(`/actors/${otherActor.id}/media`)
        .set(headers);

      expectErrorResponse(response, 404, "Actor not found");
    });
  });

  describe("DELETE /actors/:id/media/:mediaId", () => {
    it("deletes actor media", async () => {
      const actor = await createActor(user.account);
      const media = await createMedia(actor);

      const response = await request(app)
        .delete(`/actors/${actor.id}/media/${media.id}`)
        .set(headers);

      expectSuccessResponse(response);
    });

    it("prevents deleting media from different account", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);
      const otherMedia = await createMedia(otherActor);

      const response = await request(app)
        .delete(`/actors/${otherActor.id}/media/${otherMedia.id}`)
        .set(headers);

      expectErrorResponse(response, 404);
    });
  });

  describe("Multi-tenant isolation", () => {
    it("only returns actors for current app", async () => {
      const otherUser = await createAuthenticatedUser({ appSlug: "other-app" });
      await createActor(user.account, { name: "MyActor" });
      await createActor(otherUser.account, { name: "OtherActor" });

      const response = await request(app)
        .get("/actors")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("MyActor");
    });
  });
});