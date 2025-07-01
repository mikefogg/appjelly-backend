import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "#src/index.js";
import { createAuthenticatedUser, createLinkedFamilies, createActor } from "../../helpers/mock-data.js";
import { expectSuccessResponse, expectErrorResponse, expectValidationError, expectPaginatedResponse } from "../../helpers/assertions.js";


describe("Account Links Routes", () => {
  let user;
  let headers;

  beforeEach(async () => {
    user = await createAuthenticatedUser();
    headers = {
      "X-App-Slug": user.app.slug,
      "X-Test-User-Id": user.account.clerk_id,
    };
  });

  describe("GET /account-links", () => {
    it("returns user's family links", async () => {
      const { userA, userB } = await createLinkedFamilies();
      
      const response = await request(app)
        .get("/account-links")
        .set(userA.headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(1);
      expect(data[0]).toHaveProperty("status", "accepted");
      expect(data[0]).toHaveProperty("linked_account");
      expect(data[0].linked_account.id).toBe(userB.account.id);
    });

    it("returns empty array when no links", async () => {
      const response = await request(app)
        .get("/account-links")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(0);
    });

    it("filters by status", async () => {
      const otherUser = await createAuthenticatedUser({ app: user.app });
      
      // Create pending link
      const { AccountLink } = await import("#src/models/index.js");
      await AccountLink.query().insert({
        account_id: user.account.id,
        linked_account_id: otherUser.account.id,
        app_id: user.app.id,
        status: "pending",
        created_by_id: user.account.id,
        metadata: {}
      });

      const response = await request(app)
        .get("/account-links?status=pending")
        .set(headers);

      const data = expectPaginatedResponse(response);
      expect(data).toHaveLength(1);
      expect(data[0].status).toBe("pending");
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .get("/account-links")
        .set("X-App-Slug", user.app.slug);

      expectErrorResponse(response, 401);
    });
  });

  describe("POST /account-links", () => {
    it("creates family link request by email", async () => {
      const targetUser = await createAuthenticatedUser({ app: user.app });

      const response = await request(app)
        .post("/account-links")
        .set(headers)
        .send({
          linked_account_email: targetUser.account.email,
          metadata: { relationship: "sibling" }
        });

      const data = expectSuccessResponse(response, 201);
      expect(data.status).toBe("pending");
      expect(data.linked_account_id).toBe(targetUser.account.id);
      expect(data.created_by_id).toBe(user.account.id);
      expect(data.metadata.relationship).toBe("sibling");
    });

    it("creates family link request by clerk_id", async () => {
      const targetUser = await createAuthenticatedUser({ app: user.app });

      const response = await request(app)
        .post("/account-links")
        .set(headers)
        .send({
          linked_account_clerk_id: targetUser.account.clerk_id,
          metadata: { relationship: "parent" }
        });

      const data = expectSuccessResponse(response, 201);
      expect(data.status).toBe("pending");
      expect(data.linked_account_id).toBe(targetUser.account.id);
    });

    it("prevents linking to self", async () => {
      const response = await request(app)
        .post("/account-links")
        .set(headers)
        .send({
          linked_account_email: user.account.email
        });

      expectErrorResponse(response, 400, "Cannot link to yourself");
    });

    it("prevents duplicate links", async () => {
      const targetUser = await createAuthenticatedUser({ app: user.app });

      // Create first link
      await request(app)
        .post("/account-links")
        .set(headers)
        .send({
          linked_account_email: targetUser.account.email
        });

      // Try to create duplicate
      const response = await request(app)
        .post("/account-links")
        .set(headers)
        .send({
          linked_account_email: targetUser.account.email
        });

      expectErrorResponse(response, 409, "Link already exists");
    });

    it("validates input parameters", async () => {
      const response = await request(app)
        .post("/account-links")
        .set(headers)
        .send({}); // Missing required fields

      expectValidationError(response);
    });

    it("validates email format", async () => {
      const response = await request(app)
        .post("/account-links")
        .set(headers)
        .send({
          linked_account_email: "invalid-email"
        });

      expectValidationError(response, "linked_account_email");
    });

    it("returns 404 for non-existent target account", async () => {
      const response = await request(app)
        .post("/account-links")
        .set(headers)
        .send({
          linked_account_email: "nonexistent@example.com"
        });

      expectErrorResponse(response, 404, "Target account not found");
    });
  });

  describe("PATCH /account-links/:id", () => {
    let linkRequest;
    let targetUser;

    beforeEach(async () => {
      targetUser = await createAuthenticatedUser({ app: user.app });
      
      // Create pending link
      const { AccountLink } = await import("#src/models/index.js");
      linkRequest = await AccountLink.query().insert({
        account_id: user.account.id, // Current user sends the request
        linked_account_id: targetUser.account.id, // Target user receives the request
        app_id: user.app.id,
        status: "pending",
        created_by_id: user.account.id,
        metadata: {}
      });
    });

    it("accepts family link request", async () => {
      const response = await request(app)
        .patch(`/account-links/${linkRequest.id}`)
        .set({
          "X-App-Slug": targetUser.app.slug,
          "X-Test-User-Id": targetUser.account.clerk_id,
        })
        .send({
          status: "accepted"
        });

      const data = expectSuccessResponse(response);
      expect(data.status).toBe("accepted");
    });

    it("rejects family link request", async () => {
      const response = await request(app)
        .patch(`/account-links/${linkRequest.id}`)
        .set({
          "X-App-Slug": targetUser.app.slug,
          "X-Test-User-Id": targetUser.account.clerk_id,
        })
        .send({
          status: "rejected",
          metadata: { reason: "don't know this person" }
        });

      const data = expectSuccessResponse(response);
      expect(data.status).toBe("revoked");
      expect(data.metadata.reason).toBe("don't know this person");
    });

    it("validates status values", async () => {
      const response = await request(app)
        .patch(`/account-links/${linkRequest.id}`)
        .set({
          "X-App-Slug": targetUser.app.slug,
          "X-Test-User-Id": targetUser.account.clerk_id,
        })
        .send({
          status: "invalid_status"
        });

      expectValidationError(response, "status");
    });

    it("prevents unauthorized updates", async () => {
      const unauthorizedUser = await createAuthenticatedUser({ app: user.app });

      const response = await request(app)
        .patch(`/account-links/${linkRequest.id}`)
        .set({
          "X-App-Slug": unauthorizedUser.app.slug,
          "X-Test-User-Id": unauthorizedUser.account.clerk_id,
        })
        .send({
          status: "accepted"
        });

      expectErrorResponse(response, 404, "Account link not found");
    });
  });

  describe("DELETE /account-links/:id", () => {
    let accountLink;

    beforeEach(async () => {
      const { userA, userB } = await createLinkedFamilies();
      
      const { AccountLink } = await import("#src/models/index.js");
      accountLink = await AccountLink.query()
        .where("account_id", userA.account.id)
        .first();
      
      // Update headers to use userA
      headers = {
        "X-App-Slug": userA.app.slug,
        "X-Test-User-Id": userA.account.clerk_id,
      };
    });

    it("removes family link", async () => {
      const response = await request(app)
        .delete(`/account-links/${accountLink.id}`)
        .set(headers);

      expectSuccessResponse(response);

      // Verify deletion
      const getResponse = await request(app)
        .get("/account-links")
        .set(headers);

      const data = expectPaginatedResponse(getResponse);
      expect(data).toHaveLength(0);
    });

    it("prevents unauthorized deletion", async () => {
      const unauthorizedUser = await createAuthenticatedUser({ app: user.app });

      const response = await request(app)
        .delete(`/account-links/${accountLink.id}`)
        .set({
          "X-App-Slug": unauthorizedUser.app.slug,
          "X-Test-User-Id": unauthorizedUser.account.clerk_id,
        });

      expectErrorResponse(response, 404, "Account link not found");
    });
  });

  describe("GET /account-links/actors", () => {
    it("returns actors from linked families", async () => {
      const { userA, userB } = await createLinkedFamilies();
      
      // Create actors for both users
      const actorA = await createActor(userA.account, { name: "Alice" });
      const actorB = await createActor(userB.account, { name: "Bob" });

      const response = await request(app)
        .get("/account-links/actors")
        .set({
          "X-App-Slug": userA.app.slug,
          "X-Test-User-Id": userA.account.clerk_id,
        });

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
      
      // Should include linked family's actors
      const actorIds = data.map(a => a.id);
      expect(actorIds).toContain(actorB.id);
    });

    it("includes actor owner information", async () => {
      const { userA, userB } = await createLinkedFamilies();
      await createActor(userB.account, { name: "Bob" });

      const response = await request(app)
        .get("/account-links/actors")
        .set({
          "X-App-Slug": userA.app.slug,
          "X-Test-User-Id": userA.account.clerk_id,
        });

      const data = expectSuccessResponse(response);
      const linkedActor = data.find(a => a.name === "Bob");
      
      // For security, linked actors should NOT expose account details
      expect(linkedActor.account).toBeNull();
      expect(linkedActor.owner).toBeNull();
      expect(linkedActor).toHaveProperty("is_linked_family", true);
      expect(linkedActor).toHaveProperty("access_type", "linked");
      // Should only have basic info: id, name, type
      expect(linkedActor).toHaveProperty("id");
      expect(linkedActor).toHaveProperty("name", "Bob");
      expect(linkedActor).toHaveProperty("type");
      // Should NOT have sensitive data
      expect(linkedActor).not.toHaveProperty("metadata");
      expect(linkedActor).not.toHaveProperty("account_id");
    });

    it("returns empty array with no family links", async () => {
      const response = await request(app)
        .get("/account-links/actors")
        .set(headers);

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    });

    it("filters by actor type", async () => {
      const { userA, userB } = await createLinkedFamilies();
      await createActor(userB.account, { name: "Child", type: "child" });
      await createActor(userB.account, { name: "Pet", type: "pet" });

      const response = await request(app)
        .get("/account-links/actors?type=child")
        .set({
          "X-App-Slug": userA.app.slug,
          "X-Test-User-Id": userA.account.clerk_id,
        });

      const data = expectSuccessResponse(response);
      expect(data.every(a => a.type === "child")).toBe(true);
    });
  });

  describe("Multi-tenant isolation", () => {
    it("isolates family links by app", async () => {
      const otherAppUser = await createAuthenticatedUser({ appSlug: "other-app" });
      
      // Try to create link across apps
      const response = await request(app)
        .post("/account-links")
        .set(headers)
        .send({
          linked_account_email: otherAppUser.account.email
        });

      expectErrorResponse(response, 404, "Target account not found");
    });

    it("only shows links within same app", async () => {
      const { userA } = await createLinkedFamilies();

      // Check that links are isolated by app
      const response = await request(app)
        .get("/account-links")
        .set({
          "X-App-Slug": userA.app.slug,
          "X-Test-User-Id": userA.account.clerk_id,
        });

      const data = expectPaginatedResponse(response);
      expect(data.every(link => link.app_id === userA.app.id)).toBe(true);
    });
  });

  describe("Business logic", () => {
    it("creates bidirectional family link", async () => {
      const targetUser = await createAuthenticatedUser({ app: user.app });

      // Create link request
      await request(app)
        .post("/account-links")
        .set(headers)
        .send({
          linked_account_email: targetUser.account.email
        });

      // Accept from target user's perspective
      const { AccountLink } = await import("#src/models/index.js");
      const linkRequest = await AccountLink.query()
        .where("linked_account_id", targetUser.account.id)
        .where("account_id", user.account.id)
        .first();

      await request(app)
        .patch(`/account-links/${linkRequest.id}`)
        .set({
          "X-App-Slug": targetUser.app.slug,
          "X-Test-User-Id": targetUser.account.clerk_id,
        })
        .send({ status: "accepted" });

      // Both users should see the link
      const userLinksResponse = await request(app)
        .get("/account-links")
        .set(headers);

      const targetLinksResponse = await request(app)
        .get("/account-links")
        .set({
          "X-App-Slug": targetUser.app.slug,
          "X-Test-User-Id": targetUser.account.clerk_id,
        });

      const userData = expectPaginatedResponse(userLinksResponse);
      const targetData = expectPaginatedResponse(targetLinksResponse);
      
      expect(userData).toHaveLength(1);
      expect(targetData).toHaveLength(1);
    });
  });
});