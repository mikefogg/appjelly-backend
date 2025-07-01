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
  });

  describe("GET /app/sample-content", () => {
    it("returns sample content for app", async () => {
      const response = await request(app)
        .get("/app/sample-content")
        .set("X-App-Slug", "test-app");

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("sample_stories");
      expect(data).toHaveProperty("sample_characters");
      expect(data).toHaveProperty("sample_prompts");
      
      expect(Array.isArray(data.sample_stories)).toBe(true);
      expect(Array.isArray(data.sample_characters)).toBe(true);
      expect(Array.isArray(data.sample_prompts)).toBe(true);
    });

    it("returns app-specific sample content", async () => {
      // Update app with custom sample content
      await testApp.$query().patch({
        config: {
          ...testApp.config,
          sample_content: {
            stories: [
              {
                title: "Custom Story",
                preview: "A custom story for this app...",
                characters: ["Hero", "Dragon"]
              }
            ],
            characters: [
              { name: "Custom Hero", type: "character", traits: ["brave"] }
            ],
            prompts: [
              "A custom adventure prompt"
            ]
          }
        }
      });

      const response = await request(app)
        .get("/app/sample-content")
        .set("X-App-Slug", "test-app");

      const data = expectSuccessResponse(response);
      expect(data.sample_stories[0].title).toBe("Custom Story");
      expect(data.sample_characters[0].name).toBe("Custom Hero");
      expect(data.sample_prompts).toContain("A custom adventure prompt");
    });

    it("returns default sample content when none configured", async () => {
      const response = await request(app)
        .get("/app/sample-content")
        .set("X-App-Slug", "test-app");

      const data = expectSuccessResponse(response);
      
      // Should have default content
      expect(data.sample_stories.length).toBeGreaterThan(0);
      expect(data.sample_characters.length).toBeGreaterThan(0);
      expect(data.sample_prompts.length).toBeGreaterThan(0);
      
      // Verify structure of default content
      const story = data.sample_stories[0];
      expect(story).toHaveProperty("title");
      expect(story).toHaveProperty("preview");
      expect(story).toHaveProperty("characters");
      
      const character = data.sample_characters[0];
      expect(character).toHaveProperty("name");
      expect(character).toHaveProperty("type");
    });

    it("requires app context", async () => {
      const response = await request(app)
        .get("/app/sample-content");

      expectErrorResponse(response, 400, "App context required");
    });

    it("returns 404 for non-existent app", async () => {
      const response = await request(app)
        .get("/app/sample-content")
        .set("X-App-Slug", "nonexistent-app");

      expectErrorResponse(response, 404, "App not found");
    });
  });

  describe("Content filtering by app features", () => {
    it("filters sample content based on enabled features", async () => {
      // Create app with limited features
      const limitedApp = await createApp({
        slug: "limited-app",
        config: {
          features: ["stories"], // No sharing feature
        }
      });

      const response = await request(app)
        .get("/app/sample-content")
        .set("X-App-Slug", "limited-app");

      const data = expectSuccessResponse(response);
      
      // Should still return content, but may be filtered based on features
      expect(data.sample_stories.length).toBeGreaterThan(0);
    });

    it("includes feature flags in config response", async () => {
      const response = await request(app)
        .get("/app/config")
        .set("X-App-Slug", "test-app");

      const data = expectSuccessResponse(response);
      expect(data.config.features).toContain("stories");
      expect(data.config.features).toContain("sharing");
    });
  });

  describe("Caching and performance", () => {
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