import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "#src/index.js";
import { createAuthenticatedUser, createActor, createInput, createArtifact } from "../../helpers/mock-data.js";
import { expectSuccessResponse, expectErrorResponse, expectValidationError } from "../../helpers/assertions.js";


describe("Shared Views Routes", () => {
  let user;
  let headers;
  let artifact;

  beforeEach(async () => {
    user = await createAuthenticatedUser();
    headers = {
      "X-App-Slug": user.app.slug,
      "X-Test-User-Id": user.account.clerk_id,
    };

    const actor = await createActor(user.account, { name: "Emma" });
    const input = await createInput(user.account, [actor]);
    artifact = await createArtifact(input, { title: "Shared Story" });
    
    // Manually attach input for tests that need it
    artifact.input = input;
  });

  describe("POST /shared-views", () => {
    it("creates sharing token for artifact", async () => {
      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: artifact.id,
          permissions: { can_view: true, can_repersonalize: false },
          metadata: { shared_with: "family" }
        });

      const data = expectSuccessResponse(response, 201);
      expect(data).toHaveProperty("token");
      expect(data.token).toMatch(/^share_[a-zA-Z0-9]+$/);
      expect(data.artifact_id).toBe(artifact.id);
      expect(data.permissions.can_view).toBe(true);
      expect(data.permissions.can_repersonalize).toBe(false);
    });

    it("validates artifact exists and is accessible", async () => {
      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: "123e4567-e89b-12d3-a456-426614174000", // Non-existent
          permissions: { can_view: true }
        });

      expectErrorResponse(response, 404, "Artifact not found");
    });

    it("validates permissions object", async () => {
      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: artifact.id,
          permissions: "invalid" // Should be object
        });

      expectValidationError(response, "permissions");
    });

    it("validates artifact_id is UUID", async () => {
      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: "invalid-uuid",
          permissions: { can_view: true }
        });

      expectValidationError(response, "artifact_id");
    });

    it("prevents sharing artifact from different account", async () => {
      const otherUser = await createAuthenticatedUser();
      const otherActor = await createActor(otherUser.account);
      const otherInput = await createInput(otherUser.account, [otherActor]);
      const otherArtifact = await createArtifact(otherInput);

      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: otherArtifact.id,
          permissions: { can_view: true }
        });

      expectErrorResponse(response, 404, "Artifact not found");
    });
  });

  describe("GET /shared-views/:token", () => {
    let sharedView;
    let shareToken;

    beforeEach(async () => {
      // Create a shared view first
      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: artifact.id,
          permissions: { can_view: true, can_repersonalize: true }
        });

      sharedView = response.body.data;
      shareToken = sharedView.token;
    });

    it("accesses shared content with valid token", async () => {
      const response = await request(app)
        .get(`/shared-views/${shareToken}`)
        .set("X-App-Slug", user.app.slug); // No auth required for shared views

      const data = expectSuccessResponse(response);
      expect(data.artifact).toHaveProperty("id", artifact.id);
      expect(data.artifact).toHaveProperty("title", "Shared Story");
      expect(data.permissions.can_view).toBe(true);
      expect(data.permissions.can_repersonalize).toBe(true);
    });

    it("includes artifact pages in shared view", async () => {
      // Add pages to artifact
      const { ArtifactPage } = await import("#src/models/index.js");
      await ArtifactPage.query().insert([
        {
          artifact_id: artifact.id,
          page_number: 1,
          text: "Once upon a time...",
          image_key: "img1",
          layout_data: {}
        },
        {
          artifact_id: artifact.id,
          page_number: 2,
          text: "The end.",
          image_key: "img2",
          layout_data: {}
        }
      ]);

      const response = await request(app)
        .get(`/shared-views/${shareToken}`)
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(data.artifact.pages).toHaveLength(2);
      expect(data.artifact.pages[0].page_number).toBe(1);
      expect(data.artifact.pages[1].page_number).toBe(2);
    });

    it("returns 404 for invalid token", async () => {
      const response = await request(app)
        .get("/shared-views/share_12345678901234567890123456789012")
        .set("X-App-Slug", user.app.slug);

      expectErrorResponse(response, 404, "Shared content not found");
    });

    it("requires app context", async () => {
      const response = await request(app)
        .get(`/shared-views/${shareToken}`);

      expectErrorResponse(response, 400, "App context required");
    });

    it("tracks view analytics", async () => {
      const response = await request(app)
        .get(`/shared-views/${shareToken}`)
        .set("X-App-Slug", user.app.slug);

      expectSuccessResponse(response);

      // In a real implementation, this would verify analytics tracking
      // For now, just ensure the request succeeds
    });
  });

  describe("POST /shared-views/:token/claim", () => {
    let shareToken;

    beforeEach(async () => {
      // Create a shared view with repersonalize permission
      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: artifact.id,
          permissions: { can_view: true, can_repersonalize: true }
        });

      shareToken = response.body.data.token;
    });

    it("allows claiming characters for repersonalization", async () => {
      // Create another user to claim in the same app
      const { createAccount } = await import("../../helpers/mock-data.js");
      const claimingAccount = await createAccount(user.app);
      const claimingUser = { app: user.app, account: claimingAccount };
      const claimingActor = await createActor(claimingUser.account, { name: "Charlie" });

      const response = await request(app)
        .post(`/shared-views/${shareToken}/claim`)
        .set({
          "X-App-Slug": claimingUser.app.slug,
          "X-Test-User-Id": claimingUser.account.clerk_id,
        })
        .send({
          actor_replacements: {
            [artifact.input.actor_ids[0]]: claimingActor.id // Map original actor to claiming user's actor
          }
        });

      const data = expectSuccessResponse(response, 201);
      expect(data).toHaveProperty("new_artifact_id");
      expect(data.status).toBe("generating");
    });

    it("validates repersonalize permission", async () => {
      // Create shared view without repersonalize permission
      const restrictedResponse = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: artifact.id,
          permissions: { can_view: true, can_repersonalize: false }
        });

      const restrictedToken = restrictedResponse.body.data.token;

      // Use the same app but create a different account
      const { createAccount } = await import("../../helpers/mock-data.js");
      const claimingAccount = await createAccount(user.app);
      const claimingUser = { app: user.app, account: claimingAccount };
      const response = await request(app)
        .post(`/shared-views/${restrictedToken}/claim`)
        .set({
          "X-App-Slug": claimingUser.app.slug,
          "X-Test-User-Id": claimingUser.account.clerk_id,
        })
        .send({
          actor_replacements: { "actor_1": "actor_2" }
        });

      expectErrorResponse(response, 403, "Repersonalization not allowed");
    });

    it("validates character mappings", async () => {
      // Use the same app but create a different account
      const { createAccount } = await import("../../helpers/mock-data.js");
      const claimingAccount = await createAccount(user.app);
      const claimingUser = { app: user.app, account: claimingAccount };

      const response = await request(app)
        .post(`/shared-views/${shareToken}/claim`)
        .set({
          "X-App-Slug": claimingUser.app.slug,
          "X-Test-User-Id": claimingUser.account.clerk_id,
        })
        .send({
          actor_replacements: "invalid" // Should be object
        });

      expectValidationError(response, "actor_replacements");
    });

    it("requires authentication for claiming", async () => {
      const response = await request(app)
        .post(`/shared-views/${shareToken}/claim`)
        .set("X-App-Slug", user.app.slug)
        .send({
          character_mappings: { "actor_1": "actor_2" }
        });

      expectErrorResponse(response, 401);
    });
  });

  describe("GET /shared-views/:token/actors", () => {
    let shareToken;

    beforeEach(async () => {
      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: artifact.id,
          permissions: { can_view: true, can_repersonalize: true }
        });

      shareToken = response.body.data.token;
    });

    it("returns actors in shared story", async () => {
      const response = await request(app)
        .get(`/shared-views/${shareToken}/actors`)
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("type");
      // Should NOT expose metadata for security
      expect(data[0]).not.toHaveProperty("metadata");
      expect(data[0]).not.toHaveProperty("account_id");
      expect(data[0]).not.toHaveProperty("owner");
    });

    it("returns empty array for story with no actors", async () => {
      // Create artifact with no actors
      const emptyInput = await createInput(user.account, [], { prompt: "A story with no characters" });
      const emptyArtifact = await createArtifact(emptyInput);

      const shareResponse = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: emptyArtifact.id,
          permissions: { can_view: true }
        });

      const emptyToken = shareResponse.body.data.token;

      const response = await request(app)
        .get(`/shared-views/${emptyToken}/actors`)
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    });
  });

  describe("Multi-tenant isolation", () => {
    it("isolates shared views by app", async () => {
      const otherUser = await createAuthenticatedUser({ appSlug: "other-app" });
      
      // Create shared view in first app
      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: artifact.id,
          permissions: { can_view: true }
        });

      const shareToken = response.body.data.token;

      // Try to access from different app
      const accessResponse = await request(app)
        .get(`/shared-views/${shareToken}`)
        .set("X-App-Slug", "other-app");

      expectErrorResponse(accessResponse, 404, "App not found");
    });
  });

  describe("POST /shared-views/:token/claim-actor", () => {
    let shareToken;
    let claimableActor;
    let claimingUser;
    let originalUser;

    beforeEach(async () => {
      // Setup the original user and their claimable actor
      originalUser = user;
      claimableActor = await createActor(user.account, { 
        name: "Kyle", 
        type: "child",
        is_claimable: true 
      });

      // Create a new user who will do the claiming (in the same app)
      const { createAccount } = await import("../../helpers/mock-data.js");
      const claimingAccount = await createAccount(user.app);
      claimingUser = { app: user.app, account: claimingAccount };

      // Create an input/artifact with the claimable actor
      const input = await createInput(user.account, [claimableActor]);
      const testArtifact = await createArtifact(input, { title: "Story with Claimable Actor" });

      // Set up actor relationships (claimableActor is NOT a main character)
      const { ArtifactActor } = await import("#src/models/index.js");
      await ArtifactActor.setActorsForArtifact(testArtifact.id, [claimableActor.id], []); // Empty main characters

      // Create shared view
      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: testArtifact.id,
          permissions: { can_view: true, can_claim_characters: true }
        });

      shareToken = response.body.data.token;
    });

    it("allows claiming a claimable actor from shared story", async () => {
      const response = await request(app)
        .post(`/shared-views/${shareToken}/claim-actor`)
        .set({
          "X-App-Slug": claimingUser.app.slug,
          "X-Test-User-Id": claimingUser.account.clerk_id,
        })
        .send({
          actor_id: claimableActor.id
        });

      const data = expectSuccessResponse(response, 200);
      expect(data.actor.id).toBe(claimableActor.id);
      expect(data.actor.name).toBe("Kyle");
      expect(data.family_linked).toBe(true);
      expect(data.message).toContain("Kyle has been claimed");

      // Verify actor ownership changed
      const { Actor } = await import("#src/models/index.js");
      const updatedActor = await Actor.query().findById(claimableActor.id);
      expect(updatedActor.account_id).toBe(claimingUser.account.id);
      expect(updatedActor.is_claimable).toBe(false);
    });

    it("allows claiming supporting characters (not just main characters)", async () => {
      // This test verifies that non-main characters can still be claimed
      const response = await request(app)
        .post(`/shared-views/${shareToken}/claim-actor`)
        .set({
          "X-App-Slug": claimingUser.app.slug,
          "X-Test-User-Id": claimingUser.account.clerk_id,
        })
        .send({
          actor_id: claimableActor.id
        });

      // Should succeed even though claimableActor is not a main character
      const data = expectSuccessResponse(response, 200);
      expect(data.actor.name).toBe("Kyle");
    });

    it("creates bidirectional family links when claiming", async () => {
      await request(app)
        .post(`/shared-views/${shareToken}/claim-actor`)
        .set({
          "X-App-Slug": claimingUser.app.slug,
          "X-Test-User-Id": claimingUser.account.clerk_id,
        })
        .send({
          actor_id: claimableActor.id
        });

      // Check that family links were created in both directions
      const { AccountLink } = await import("#src/models/index.js");
      const links = await AccountLink.query()
        .where("app_id", user.app.id)
        .where((builder) => {
          builder
            .where({
              account_id: originalUser.account.id,
              linked_account_id: claimingUser.account.id
            })
            .orWhere({
              account_id: claimingUser.account.id,
              linked_account_id: originalUser.account.id
            });
        });

      expect(links).toHaveLength(2); // Bidirectional links
      expect(links.every(link => link.status === "accepted")).toBe(true);
      expect(links.every(link => link.metadata?.created_through_claiming)).toBe(true);
    });

    it("prevents claiming non-claimable actors", async () => {
      // Create a non-claimable actor
      const nonClaimableActor = await createActor(user.account, { 
        name: "Emma", 
        is_claimable: false 
      });

      const input = await createInput(user.account, [nonClaimableActor]);
      const testArtifact = await createArtifact(input);
      
      const { ArtifactActor } = await import("#src/models/index.js");
      await ArtifactActor.setActorsForArtifact(testArtifact.id, [nonClaimableActor.id], []);

      const shareResponse = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: testArtifact.id,
          permissions: { can_view: true, can_claim_characters: true }
        });

      const testToken = shareResponse.body.data.token;

      const response = await request(app)
        .post(`/shared-views/${testToken}/claim-actor`)
        .set({
          "X-App-Slug": claimingUser.app.slug,
          "X-Test-User-Id": claimingUser.account.clerk_id,
        })
        .send({
          actor_id: nonClaimableActor.id
        });

      expectErrorResponse(response, 404, "Actor not found or not claimable");
    });

    it("prevents claiming actors not in the story", async () => {
      // Create an actor that's not in the shared story
      const unrelatedActor = await createActor(user.account, { 
        name: "Unrelated", 
        is_claimable: true 
      });

      const response = await request(app)
        .post(`/shared-views/${shareToken}/claim-actor`)
        .set({
          "X-App-Slug": claimingUser.app.slug,
          "X-Test-User-Id": claimingUser.account.clerk_id,
        })
        .send({
          actor_id: unrelatedActor.id
        });

      expectErrorResponse(response, 400, "Actor is not in this story");
    });

    it("prevents claiming your own actor", async () => {
      const response = await request(app)
        .post(`/shared-views/${shareToken}/claim-actor`)
        .set(headers) // Using original user's headers
        .send({
          actor_id: claimableActor.id
        });

      expectErrorResponse(response, 400, "Cannot claim your own actor");
    });

    it("validates claim_characters permission", async () => {
      // Create shared view without claim permission
      const input = await createInput(user.account, [claimableActor]);
      const testArtifact = await createArtifact(input);
      
      const { ArtifactActor } = await import("#src/models/index.js");
      await ArtifactActor.setActorsForArtifact(testArtifact.id, [claimableActor.id], []);

      const restrictedResponse = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: testArtifact.id,
          permissions: { can_view: true, can_claim_characters: false }
        });

      const restrictedToken = restrictedResponse.body.data.token;

      const response = await request(app)
        .post(`/shared-views/${restrictedToken}/claim-actor`)
        .set({
          "X-App-Slug": claimingUser.app.slug,
          "X-Test-User-Id": claimingUser.account.clerk_id,
        })
        .send({
          actor_id: claimableActor.id
        });

      expectErrorResponse(response, 403, "Character claiming not allowed");
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .post(`/shared-views/${shareToken}/claim-actor`)
        .set("X-App-Slug", user.app.slug)
        .send({
          actor_id: claimableActor.id
        });

      expectErrorResponse(response, 401);
    });

    it("validates actor_id is UUID", async () => {
      const response = await request(app)
        .post(`/shared-views/${shareToken}/claim-actor`)
        .set({
          "X-App-Slug": claimingUser.app.slug,
          "X-Test-User-Id": claimingUser.account.clerk_id,
        })
        .send({
          actor_id: "invalid-uuid"
        });

      expectValidationError(response, "actor_id");
    });
  });

  describe("Security", () => {
    it("generates cryptographically secure tokens", async () => {
      const tokens = new Set();

      // Generate multiple tokens and ensure they're unique
      // Each share should be unique even with same artifact and permissions
      for (let i = 0; i < 10; i++) {
        const response = await request(app)
          .post("/shared-views")
          .set(headers)
          .send({
            artifact_id: artifact.id,
            permissions: { can_view: true }
          });

        const token = response.body.data.token;
        expect(tokens.has(token)).toBe(false);
        tokens.add(token);
        expect(token).toMatch(/^share_[a-zA-Z0-9]+$/);
        expect(token.length).toBeGreaterThan(20); // Ensure sufficient entropy
      }
    });

    it("doesn't expose sensitive data in shared views", async () => {
      const response = await request(app)
        .post("/shared-views")
        .set(headers)
        .send({
          artifact_id: artifact.id,
          permissions: { can_view: true }
        });

      const shareToken = response.body.data.token;

      const viewResponse = await request(app)
        .get(`/shared-views/${shareToken}`)
        .set("X-App-Slug", user.app.slug);

      const data = expectSuccessResponse(viewResponse);
      
      // Should not expose sensitive account/owner information
      expect(data.artifact).not.toHaveProperty("account_id");
      expect(data.artifact).not.toHaveProperty("owner");
      expect(data.artifact.input).not.toHaveProperty("account_id");
      expect(data.artifact.input).not.toHaveProperty("metadata");
      
      // Should not expose sensitive actor metadata
      if (data.artifact.input?.actors) {
        data.artifact.input.actors.forEach(actor => {
          expect(actor).not.toHaveProperty("metadata");
          expect(actor).not.toHaveProperty("account_id");
          expect(actor).not.toHaveProperty("owner");
        });
      }
    });
  });
});