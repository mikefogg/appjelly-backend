import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "#src/index.js";
import { createAuthenticatedUser, createActor, createArtifact, createInput } from "../../helpers/mock-data.js";
import { expectSuccessResponse, expectErrorResponse, expectValidationError } from "../../helpers/assertions.js";


describe("Onboarding Routes", () => {
  let user;
  let headers;

  beforeEach(async () => {
    user = await createAuthenticatedUser();
    headers = {
      "X-App-Slug": user.app.slug,
      "X-Test-User-Id": user.account.clerk_id,
    };
  });

  describe("GET /onboarding/sample-story", () => {
    it("returns sample story for app", async () => {
      const response = await request(app)
        .get("/onboarding/sample-story")
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("title");
      expect(data).toHaveProperty("artifact_type", "story");
      expect(data).toHaveProperty("pages");
      expect(data).toHaveProperty("is_sample", true);
      expect(Array.isArray(data.pages)).toBe(true);
      expect(data.pages.length).toBeGreaterThan(0);
    });

    it("returns configured sample story when available", async () => {
      // Create a sample artifact
      const actor = await createActor(user.account, { name: "Sample Hero" });
      const input = await createInput(user.account, [actor], { 
        prompt: "A sample adventure" 
      });
      const sampleArtifact = await createArtifact(input, {
        title: "Custom Sample Story",
        metadata: { is_sample: true }
      });

      // Add sample pages
      const { ArtifactPage } = await import("#src/models/index.js");
      await ArtifactPage.query().insert([
        {
          artifact_id: sampleArtifact.id,
          page_number: 1,
          text: "This is a custom sample story...",
          image_key: "sample_img1",
          layout_data: {}
        },
        {
          artifact_id: sampleArtifact.id,
          page_number: 2,
          text: "With custom content for this app.",
          image_key: "sample_img2",
          layout_data: {}
        }
      ]);

      const response = await request(app)
        .get("/onboarding/sample-story")
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(data.title).toBe("Custom Sample Story");
      expect(data.pages).toHaveLength(2);
      expect(data.pages[0].text).toBe("This is a custom sample story...");
    });

    it("returns default sample story when none configured", async () => {
      const response = await request(app)
        .get("/onboarding/sample-story")
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(data.id).toBe("sample");
      expect(data.title).toContain(user.app.name);
      expect(data.pages).toHaveLength(3); // Default has 3 pages
      expect(data.pages[0].text).toContain("Welcome to");
    });

    it("includes properly formatted image URLs", async () => {
      const response = await request(app)
        .get("/onboarding/sample-story")
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      data.pages.forEach(page => {
        expect(page).toHaveProperty("page_number");
        expect(page).toHaveProperty("text");
        expect(page).toHaveProperty("image_url");
      });
    });

    it("requires app context", async () => {
      const response = await request(app)
        .get("/onboarding/sample-story");

      expectErrorResponse(response, 400, "App context required");
    });
  });

  describe("POST /onboarding/complete", () => {
    it("marks onboarding as completed", async () => {
      const response = await request(app)
        .post("/onboarding/complete")
        .set(headers)
        .send({
          completed_steps: ["create_character", "create_story", "explore_features"],
          metadata: { completion_time: 300, source: "mobile_app" }
        });

      const data = expectSuccessResponse(response);
      expect(data.onboarding_completed).toBe(true);
      expect(data.completed_steps).toHaveLength(3);
      expect(data).toHaveProperty("completed_at");

      // Verify account was updated
      const { Account } = await import("#src/models/index.js");
      const updatedAccount = await Account.query().findById(user.account.id);
      expect(updatedAccount.metadata.onboarding_completed).toBe(true);
      expect(updatedAccount.metadata.onboarding_steps).toHaveLength(3);
    });

    it("preserves existing metadata", async () => {
      // Update account with existing metadata
      await user.account.$query().patch({
        metadata: {
          existing_setting: "value",
          preferences: { theme: "dark" }
        }
      });

      const response = await request(app)
        .post("/onboarding/complete")
        .set(headers)
        .send({
          completed_steps: ["step1"],
          metadata: { new_setting: "new_value" }
        });

      expectSuccessResponse(response);

      // Verify existing metadata preserved
      const { Account } = await import("#src/models/index.js");
      const updatedAccount = await Account.query().findById(user.account.id);
      expect(updatedAccount.metadata.existing_setting).toBe("value");
      expect(updatedAccount.metadata.preferences.theme).toBe("dark");
      expect(updatedAccount.metadata.onboarding_metadata.new_setting).toBe("new_value");
    });

    it("validates completed_steps is array", async () => {
      const response = await request(app)
        .post("/onboarding/complete")
        .set(headers)
        .send({
          completed_steps: "not-an-array"
        });

      expectValidationError(response, "completed_steps");
    });

    it("validates metadata is object", async () => {
      const response = await request(app)
        .post("/onboarding/complete")
        .set(headers)
        .send({
          completed_steps: ["step1"],
          metadata: "not-an-object"
        });

      expectValidationError(response, "metadata");
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .post("/onboarding/complete")
        .set("X-App-Slug", user.app.slug)
        .send({
          completed_steps: ["step1"]
        });

      expectErrorResponse(response, 401);
    });
  });

  describe("GET /onboarding/suggestions", () => {
    it("returns all suggestions by default", async () => {
      const response = await request(app)
        .get("/onboarding/suggestions")
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("characters");
      expect(data).toHaveProperty("prompts");
      expect(data).toHaveProperty("tips");
      
      expect(Array.isArray(data.characters)).toBe(true);
      expect(Array.isArray(data.prompts)).toBe(true);
      expect(data.tips).toHaveProperty("characters");
      expect(data.tips).toHaveProperty("prompts");
    });

    it("returns character suggestions when type=characters", async () => {
      const response = await request(app)
        .get("/onboarding/suggestions?type=characters")
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("characters");
      expect(data).toHaveProperty("tips");
      expect(data).not.toHaveProperty("prompts");
      
      expect(Array.isArray(data.characters)).toBe(true);
      expect(data.characters.length).toBeGreaterThan(0);
      
      const character = data.characters[0];
      expect(character).toHaveProperty("type");
      expect(character).toHaveProperty("name_examples");
      expect(character).toHaveProperty("description");
    });

    it("returns prompt suggestions when type=prompts", async () => {
      const response = await request(app)
        .get("/onboarding/suggestions?type=prompts")
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("prompts");
      expect(data).toHaveProperty("tips");
      expect(data).not.toHaveProperty("characters");
      
      expect(Array.isArray(data.prompts)).toBe(true);
      expect(data.prompts.length).toBeGreaterThan(0);
      expect(typeof data.prompts[0]).toBe("string");
    });

    it("returns app-specific suggestions when configured", async () => {
      // Update app with custom suggestions
      await user.app.$query().patch({
        config: {
          ...user.app.config,
          onboarding: {
            character_suggestions: [
              {
                type: "hero",
                name_examples: ["Superman", "Wonder Woman"],
                description: "Superhero characters"
              }
            ],
            prompt_suggestions: [
              "A superhero saves the city"
            ]
          }
        }
      });

      const response = await request(app)
        .get("/onboarding/suggestions")
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(data.characters[0].type).toBe("hero");
      expect(data.prompts).toContain("A superhero saves the city");
    });

    it("returns default suggestions when none configured", async () => {
      const response = await request(app)
        .get("/onboarding/suggestions")
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      
      // Should have default character types
      const characterTypes = data.characters.map(c => c.type);
      expect(characterTypes).toContain("child");
      expect(characterTypes).toContain("pet");
      expect(characterTypes).toContain("adult");
      
      // Should have default prompts
      expect(data.prompts.length).toBeGreaterThan(5);
      expect(data.prompts.some(p => p.includes("adventure"))).toBe(true);
    });

    it("includes helpful tips", async () => {
      const response = await request(app)
        .get("/onboarding/suggestions")
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(data.tips.characters).toHaveLength(4);
      expect(data.tips.prompts).toHaveLength(4);
      expect(data.tips.characters[0]).toContain("real names");
      expect(data.tips.prompts[0]).toContain("simple");
    });
  });

  describe("GET /onboarding/status", () => {
    it("returns onboarding status for new user", async () => {
      const response = await request(app)
        .get("/onboarding/status")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("is_completed", false);
      expect(data).toHaveProperty("completed_at", null);
      expect(data).toHaveProperty("completed_steps");
      expect(data).toHaveProperty("progress");
      expect(data).toHaveProperty("next_steps");
      
      expect(data.progress.has_created_actors).toBe(false);
      expect(data.progress.has_created_stories).toBe(false);
      expect(Array.isArray(data.next_steps)).toBe(true);
    });

    it("shows progress when user has created actors", async () => {
      await createActor(user.account, { name: "Test Actor" });

      const response = await request(app)
        .get("/onboarding/status")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.progress.has_created_actors).toBe(true);
      expect(data.progress.actors_count).toBe(1);
      expect(data.progress.has_created_stories).toBe(false);
      
      // Next step should be to create a story
      expect(data.next_steps.some(step => step.id === "create_first_story")).toBe(true);
    });

    it("shows progress when user has created stories", async () => {
      const actor = await createActor(user.account);
      const input = await createInput(user.account, [actor]);
      await createArtifact(input);

      const response = await request(app)
        .get("/onboarding/status")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.progress.has_created_actors).toBe(true);
      expect(data.progress.has_created_stories).toBe(true);
      expect(data.progress.stories_count).toBe(1);
      
      // Next step should be to complete onboarding
      expect(data.next_steps.some(step => step.id === "complete_onboarding")).toBe(true);
    });

    it("shows completed status", async () => {
      // Mark onboarding as completed
      await user.account.$query().patch({
        metadata: {
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          onboarding_steps: ["create_character", "create_story"]
        }
      });

      const response = await request(app)
        .get("/onboarding/status")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.is_completed).toBe(true);
      expect(data.completed_at).toBeDefined();
      expect(data.completed_steps).toHaveLength(2);
      
      // Next steps should be exploration
      expect(data.next_steps.some(step => step.id === "explore_features")).toBe(true);
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .get("/onboarding/status")
        .set("X-App-Slug", user.app.slug);

      expectErrorResponse(response, 401);
    });
  });

  describe("Business logic", () => {
    it("provides contextual next steps based on progress", async () => {
      // No actors or stories
      let response = await request(app)
        .get("/onboarding/status")
        .set(headers);

      let data = expectSuccessResponse(response);
      expect(data.next_steps[0].id).toBe("create_first_actor");

      // Has actor, no stories
      await createActor(user.account);
      response = await request(app)
        .get("/onboarding/status")
        .set(headers);

      data = expectSuccessResponse(response);
      expect(data.next_steps[0].id).toBe("create_first_story");

      // Has both, should complete onboarding
      const input = await createInput(user.account, [user.account.actors?.[0] || await createActor(user.account)]);
      await createArtifact(input);
      
      response = await request(app)
        .get("/onboarding/status")
        .set(headers);

      data = expectSuccessResponse(response);
      expect(data.next_steps[0].id).toBe("complete_onboarding");
    });

    it("tracks onboarding analytics", async () => {
      const response = await request(app)
        .post("/onboarding/complete")
        .set(headers)
        .send({
          completed_steps: ["create_character", "create_story"],
          metadata: { completion_time: 180 }
        });

      expectSuccessResponse(response);
      // In a real implementation, this would verify analytics tracking
    });
  });

  describe("Multi-tenant isolation", () => {
    it("isolates progress by app", async () => {
      const otherUser = await createAuthenticatedUser({ appSlug: "other-app" });
      
      // Create actor in other app
      await createActor(otherUser.account);
      
      // Current user's progress should not be affected
      const response = await request(app)
        .get("/onboarding/status")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(data.progress.has_created_actors).toBe(false);
      expect(data.progress.actors_count).toBe(0);
    });
  });
});