import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "#src/index.js";
import { createApp } from "../../helpers/mock-data.js";
import { expectSuccessResponse, expectErrorResponse } from "../../helpers/assertions.js";


describe("Apps Routes", () => {
  let testApp;

  beforeEach(async () => {
    testApp = await createApp({
      slug: "test-app",
      name: "Test App",
      config: {
        features: ["stories", "sharing"],
        branding: {
          primary_color: "#3B82F6",
          logo_url: "https://example.com/logo.png"
        },
        content_limits: {
          max_actors: 10,
          max_story_length: 500
        }
      }
    });
  });

  describe("GET /app/config", () => {
    it("returns app configuration", async () => {
      const response = await request(app)
        .get("/app/config")
        .set("X-App-Slug", "test-app");

      const data = expectSuccessResponse(response);
      expect(data.slug).toBe("test-app");
      expect(data.name).toBe("Test App");
      expect(data.config).toHaveProperty("features");
      expect(data.config.features).toContain("stories");
      expect(data.config.branding.primary_color).toBe("#3B82F6");
    });

    it("requires app context", async () => {
      const response = await request(app)
        .get("/app/config");

      expectErrorResponse(response, 400, "App context required");
    });

    it("returns 404 for non-existent app", async () => {
      const response = await request(app)
        .get("/app/config")
        .set("X-App-Slug", "nonexistent-app");

      expectErrorResponse(response, 404, "App not found");
    });

    it("filters sensitive config data", async () => {
      // Update app with sensitive data
      await testApp.$query().patch({
        config: {
          ...testApp.config,
          internal: {
            api_keys: { openai: "secret-key" },
            webhook_secrets: { clerk: "secret" }
          }
        }
      });

      const response = await request(app)
        .get("/app/config")
        .set("X-App-Slug", "test-app");

      const data = expectSuccessResponse(response);
      expect(data.config).not.toHaveProperty("internal");
    });

    it("includes feature flags in config response", async () => {
      const response = await request(app)
        .get("/app/config")
        .set("X-App-Slug", "test-app");

      const data = expectSuccessResponse(response);
      expect(data.config.features).toContain("stories");
      expect(data.config.features).toContain("sharing");
    });

    it("handles multiple concurrent requests", async () => {
      const requests = Array(10).fill().map(() =>
        request(app)
          .get("/app/config")
          .set("X-App-Slug", "test-app")
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expectSuccessResponse(response);
        expect(response.body.data.slug).toBe("test-app");
      });
    });
  });
});
