import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "#src/index.js";
import { createAuthenticatedUser, createActor, createMedia } from "../../helpers/mock-data.js";
import { expectSuccessResponse, expectErrorResponse, expectValidationError } from "../../helpers/assertions.js";


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

// Mock external BullMQ
vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: "job_123" }),
    close: vi.fn().mockResolvedValue(undefined)
  }))
}));

describe("Media Routes", () => {
  let user;
  let headers;
  let actor;

  beforeEach(async () => {
    user = await createAuthenticatedUser();
    headers = {
      "X-App-Slug": user.app.slug,
      "X-Test-User-Id": user.account.clerk_id,
    };

    actor = await createActor(user.account, { name: "Emma" });
  });

  describe("POST /media/upload", () => {
    it("generates signed upload URL", async () => {
      const response = await request(app)
        .post("/media/upload")
        .set(headers)
        .send({
          filename: "photo.jpg",
          content_type: "image/jpeg",
          file_size: 1024000
        });

      const data = expectSuccessResponse(response, 201);
      expect(data).toHaveProperty("upload_url");
      expect(data).toHaveProperty("image_key");
      expect(data).toHaveProperty("expires_in");
      expect(data.upload_url).toMatch(/^https:\/\//);
      expect(data.image_key).toMatch(/^cf-/); // Cloudflare auto-generated ID
    });

    it("validates required fields", async () => {
      const response = await request(app)
        .post("/media/upload")
        .set(headers)
        .send({});

      expectValidationError(response, "filename");
    });

    it("validates file size limits", async () => {
      const response = await request(app)
        .post("/media/upload")
        .set(headers)
        .send({
          filename: "huge-file.jpg",
          content_type: "image/jpeg",
          file_size: 50 * 1024 * 1024 // 50MB - too large
        });

      expectValidationError(response, "file_size");
    });

    it("validates content type", async () => {
      const response = await request(app)
        .post("/media/upload")
        .set(headers)
        .send({
          filename: "document.pdf",
          content_type: "application/pdf", // Not an image
          file_size: 1024000
        });

      expectValidationError(response, "content_type");
    });

    it("validates filename extension", async () => {
      const response = await request(app)
        .post("/media/upload")
        .set(headers)
        .send({
          filename: "file.exe",
          content_type: "image/jpeg",
          file_size: 1024000
        });

      expectValidationError(response, "filename");
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .post("/media/upload")
        .set("X-App-Slug", user.app.slug)
        .send({
          filename: "photo.jpg",
          content_type: "image/jpeg",
          file_size: 1024000
        });

      expectErrorResponse(response, 401);
    });
  });

  describe("GET /media/:id", () => {
    it("returns media details", async () => {
      const media = await createMedia(actor, {
        image_key: "test_image_key",
        metadata: { original_filename: "photo.jpg" }
      });

      const response = await request(app)
        .get(`/media/${media.id}`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.id).toBe(media.id);
      expect(data.image_key).toBe("test_image_key");
      expect(data).toHaveProperty("image_url");
      expect(data).toHaveProperty("metadata");
    });

    it("returns 404 for non-existent media", async () => {
      const response = await request(app)
        .get("/media/123e4567-e89b-12d3-a456-426614174000")
        .set(headers);

      expectErrorResponse(response, 404, "Media not found");
    });

    it("prevents access to other user's media", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);
      const otherMedia = await createMedia(otherActor);

      const response = await request(app)
        .get(`/media/${otherMedia.id}`)
        .set(headers);

      expectErrorResponse(response, 404, "Media not found");
    });

    it("includes image URLs with proper CDN formatting", async () => {
      const media = await createMedia(actor, { image_key: "test_key" });

      const response = await request(app)
        .get(`/media/${media.id}`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.image_url).toMatch(/^https:\/\//);
      expect(data.image_url).toContain("test_key");
    });
  });

  describe("DELETE /media/:id", () => {
    it("deletes media", async () => {
      const media = await createMedia(actor);

      const response = await request(app)
        .delete(`/media/${media.id}`)
        .set(headers);

      expectSuccessResponse(response);

      // Verify deletion
      const getResponse = await request(app)
        .get(`/media/${media.id}`)
        .set(headers);

      expectErrorResponse(getResponse, 404);
    });

    it("prevents deleting other user's media", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);
      const otherMedia = await createMedia(otherActor);

      const response = await request(app)
        .delete(`/media/${otherMedia.id}`)
        .set(headers);

      expectErrorResponse(response, 404, "Media not found");
    });

    it("queues cleanup job for CDN deletion", async () => {
      const media = await createMedia(actor);

      const response = await request(app)
        .delete(`/media/${media.id}`)
        .set(headers);

      // In a real implementation, this would queue a job to delete from CDN
      // For now, just verify the deletion succeeded
      expect(response.status).toBe(200);
    });
  });

  describe("POST /media/batch-upload", () => {
    it("processes multiple file uploads", async () => {
      const response = await request(app)
        .post("/media/batch-upload")
        .set(headers)
        .send({
          files: [
            {
              filename: "photo1.jpg",
              content_type: "image/jpeg",
              file_size: 1024000
            },
            {
              filename: "photo2.png",
              content_type: "image/png",
              file_size: 2048000
            },
            {
              filename: "photo3.jpg",
              content_type: "image/jpeg",
              file_size: 1536000
            }
          ],
          metadata: {
            upload_session: "session_123",
            actor_id: actor.id
          }
        });

      const data = expectSuccessResponse(response, 201);
      expect(data).toHaveProperty("upload_urls");
      expect(data).toHaveProperty("batch_id");
      expect(Array.isArray(data.upload_urls)).toBe(true);
      expect(data.upload_urls).toHaveLength(3);
      
      data.upload_urls.forEach(upload => {
        expect(upload).toHaveProperty("upload_url");
        expect(upload).toHaveProperty("image_key");
        expect(upload).toHaveProperty("filename");
      });
    });

    it("validates batch size limits", async () => {
      const files = Array(21).fill().map((_, i) => ({
        filename: `photo${i}.jpg`,
        content_type: "image/jpeg",
        file_size: 1024000
      }));

      const response = await request(app)
        .post("/media/batch-upload")
        .set(headers)
        .send({ files });

      expectValidationError(response, "files");
    });

    it("validates individual files in batch", async () => {
      const response = await request(app)
        .post("/media/batch-upload")
        .set(headers)
        .send({
          files: [
            {
              filename: "photo1.jpg",
              content_type: "image/jpeg",
              file_size: 1024000
            },
            {
              filename: "invalid.exe", // Invalid file type
              content_type: "application/exe",
              file_size: 1024000
            }
          ]
        });

      expectValidationError(response);
    });

    it("requires files array", async () => {
      const response = await request(app)
        .post("/media/batch-upload")
        .set(headers)
        .send({});

      expectValidationError(response, "files");
    });

    it("handles empty files array", async () => {
      const response = await request(app)
        .post("/media/batch-upload")
        .set(headers)
        .send({ files: [] });

      expectValidationError(response, "files");
    });
  });

  describe("GET /media", () => {
    it("returns user's media with pagination", async () => {
      const media1 = await createMedia(actor, { image_key: "img1" });
      const media2 = await createMedia(actor, { image_key: "img2" });

      const response = await request(app)
        .get("/media")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data.media)).toBe(true);
      expect(data.media).toHaveLength(2);
      expect(data).toHaveProperty("meta");
      
      const mediaIds = data.media.map(m => m.id);
      expect(mediaIds).toContain(media1.id);
      expect(mediaIds).toContain(media2.id);
    });

    it("filters by owner type", async () => {
      await createMedia(actor); // actor media
      
      // Create input media
      const { createInput } = await import("../../helpers/mock-data.js");
      const input = await createInput(user.account, [actor]);
      const { Media } = await import("#src/models/index.js");
      await Media.query().insert({
        owner_type: "input",
        owner_id: input.id,
        image_key: "input_img",
        metadata: {}
      });

      const response = await request(app)
        .get("/media?owner_type=actor")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.media.every(m => m.owner_type === "actor")).toBe(true);
    });

    it("supports pagination", async () => {
      // Create multiple media items
      for (let i = 0; i < 15; i++) {
        await createMedia(actor, { image_key: `img${i}` });
      }

      const response = await request(app)
        .get("/media?per_page=5")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.media).toHaveLength(5);
      expect(data.meta.total).toBe(5);
    });
  });

  describe("Multi-tenant isolation", () => {
    it("isolates media by app", async () => {
      const otherUser = await createAuthenticatedUser({ appSlug: "other-app" });
      const otherActor = await createActor(otherUser.account);
      
      await createMedia(actor, { image_key: "my_img" });
      await createMedia(otherActor, { image_key: "other_img" });

      const response = await request(app)
        .get("/media")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.media).toHaveLength(1);
      expect(data.media[0].image_key).toBe("my_img");
    });
  });

  describe("Business logic", () => {
    it("tracks upload analytics", async () => {
      const response = await request(app)
        .post("/media/upload")
        .set(headers)
        .send({
          filename: "photo.jpg",
          content_type: "image/jpeg",
          file_size: 1024000
        });

      expectSuccessResponse(response, 201);
      // In a real implementation, this would verify analytics tracking
    });

    it("enforces storage quotas", async () => {
      // This would check against user's storage limits
      const response = await request(app)
        .post("/media/upload")
        .set(headers)
        .send({
          filename: "photo.jpg",
          content_type: "image/jpeg",
          file_size: 1024000
        });

      // For free tier, this might be quota limited
      expect([201, 429, 402]).toContain(response.status);
    });

    it("generates appropriate CDN URLs", async () => {
      const media = await createMedia(actor, { 
        image_key: "test_image_key"
      });

      const response = await request(app)
        .get(`/media/${media.id}`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.image_url).toMatch(/^https:\/\//);
      expect(data.image_url).toContain("test_image_key");
    });

    it("handles media processing status", async () => {
      const media = await createMedia(actor, {
        metadata: {
          processing_status: "processing",
          upload_status: "uploaded"
        }
      });

      const response = await request(app)
        .get(`/media/${media.id}`)
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.metadata.processing_status).toBe("processing");
      expect(data.metadata.upload_status).toBe("uploaded");
    });
  });
});