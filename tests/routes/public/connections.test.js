import { describe, it, expect, beforeEach, vi } from "vitest";
import app from "#src/index.js";
import { expectSuccessResponse, expectErrorResponse, expectUnauthenticatedError } from "../../helpers/assertions.js";
import {
  createTestContext,
  createTestContextWithNetwork,
  authenticatedRequest,
  unauthenticatedRequest,
} from "../../helpers/ghost-helpers.js";
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

describe("Connections Routes", () => {
  let context;

  beforeEach(async () => {
    context = await createTestContext();
    vi.clearAllMocks();
  });

  describe("GET /connections", () => {
    it("returns list of connected accounts", async () => {
      const response = await authenticatedRequest(app, "get", "/connections");

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2); // Twitter + ghost account

      // Find the twitter connection
      const twitterConnection = data.find(c => c.platform === "twitter");
      expect(twitterConnection).toBeTruthy();
      expect(twitterConnection).toHaveProperty("username", "testuser");
      expect(twitterConnection).toHaveProperty("sync_status", "ready");

      // Ghost account should also be present
      const ghostConnection = data.find(c => c.platform === "ghost");
      expect(ghostConnection).toBeTruthy();
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "get", "/connections");
      expectUnauthenticatedError(response);
    });

    it("returns only ghost account when no real connections", async () => {
      // Create new context without connected account
      const { app: newApp, account } = await createTestContext({
        userId: "user_different123",
      });

      // Delete the connected account
      await context.connectedAccount.$query().delete();

      const response = await authenticatedRequest(app, "get", "/connections");

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1); // Just the ghost account
      expect(data[0].platform).toBe("ghost");
    });
  });

  describe("GET /connections/:id", () => {
    it("returns connection details with writing style", async () => {
      const contextWithStyle = await createTestContextWithNetwork();

      const response = await authenticatedRequest(
        app,
        "get",
        `/connections/${contextWithStyle.connectedAccount.id}`
      );

      const data = expectSuccessResponse(response);
      expect(data.id).toBe(contextWithStyle.connectedAccount.id);
      expect(data.platform).toBe("twitter");
      expect(data.username).toBe("testuser");
      expect(data).toHaveProperty("writing_style");
      expect(data.writing_style).toHaveProperty("tone");
      expect(data.writing_style).toHaveProperty("avg_length");
      expect(data.writing_style).toHaveProperty("confidence_score");
      expect(data).toHaveProperty("voice");
    });

    it("returns voice field when set", async () => {
      // Set voice on connection
      await context.connectedAccount.$query().patch({
        voice: "Write like a tech entrepreneur with bold opinions"
      });

      const response = await authenticatedRequest(
        app,
        "get",
        `/connections/${context.connectedAccount.id}`
      );

      const data = expectSuccessResponse(response);
      expect(data.voice).toBe("Write like a tech entrepreneur with bold opinions");
    });

    it("returns 404 for non-existent connection", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "get", `/connections/${fakeId}`);

      expectErrorResponse(response, 404, "not found");
    });

    it("returns 404 when accessing another user's connection", async () => {
      const otherContext = await createTestContext({ userId: "user_other456" });

      const response = await authenticatedRequest(
        app,
        "get",
        `/connections/${otherContext.connectedAccount.id}`,
        "user_test123" // Try to access with original user
      );

      expectErrorResponse(response, 404, "not found");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "get",
        `/connections/${context.connectedAccount.id}`
      );
      expectUnauthenticatedError(response);
    });
  });

  describe("GET /connections/:id/status", () => {
    it("returns sync status information", async () => {
      const response = await authenticatedRequest(
        app,
        "get",
        `/connections/${context.connectedAccount.id}/status`
      );

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("sync_status", "ready");
      expect(data).toHaveProperty("last_synced_at");
      expect(data).toHaveProperty("needs_sync");
      expect(data).toHaveProperty("needs_analysis");
    });

    it("indicates when sync is needed", async () => {
      // Update last sync to be old
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 2);

      await context.connectedAccount.$query().patch({
        last_synced_at: oldDate.toISOString(),
      });

      const response = await authenticatedRequest(
        app,
        "get",
        `/connections/${context.connectedAccount.id}/status`
      );

      const data = expectSuccessResponse(response);
      expect(data.needs_sync).toBe(true);
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "get",
        `/connections/${context.connectedAccount.id}/status`
      );
      expectUnauthenticatedError(response);
    });
  });

  describe("PATCH /connections/:id/sync", () => {
    it("triggers sync and analysis jobs", async () => {
      const response = await authenticatedRequest(
        app,
        "patch",
        `/connections/${context.connectedAccount.id}/sync`
      );

      const data = expectSuccessResponse(response);
      expect(data.message).toContain("Sync initiated");
      expect(data.sync_status).toBe("syncing");

      // Verify both jobs were queued in parallel
      expect(ghostQueue.add).toHaveBeenCalledWith(
        "sync-network",
        expect.objectContaining({
          connectedAccountId: context.connectedAccount.id,
        })
      );

      expect(ghostQueue.add).toHaveBeenCalledWith(
        "analyze-style",
        expect.objectContaining({
          connectedAccountId: context.connectedAccount.id,
        })
      );
    });

    it("updates connection status to syncing", async () => {
      await authenticatedRequest(app, "patch", `/connections/${context.connectedAccount.id}/sync`);

      const updated = await context.connectedAccount.$query();
      expect(updated.sync_status).toBe("syncing");
    });

    it("returns 404 for non-existent connection", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "patch", `/connections/${fakeId}/sync`);

      expectErrorResponse(response, 404, "not found");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "patch",
        `/connections/${context.connectedAccount.id}/sync`
      );
      expectUnauthenticatedError(response);
    });
  });

  describe("DELETE /connections/:id", () => {
    it("soft deletes connection", async () => {
      const response = await authenticatedRequest(
        app,
        "delete",
        `/connections/${context.connectedAccount.id}`
      );

      const data = expectSuccessResponse(response);
      expect(data.message).toContain("disconnected");

      // Verify soft delete
      const updated = await context.connectedAccount.$query();
      expect(updated.is_active).toBe(false);
    });

    it("returns 404 for non-existent connection", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const response = await authenticatedRequest(app, "delete", `/connections/${fakeId}`);

      expectErrorResponse(response, 404, "not found");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "delete",
        `/connections/${context.connectedAccount.id}`
      );
      expectUnauthenticatedError(response);
    });
  });

  describe("Ghost Account Management", () => {
    it("prevents duplicate ghost accounts for the same user", async () => {
      const { ConnectedAccount } = await import("#src/models/index.js");

      // First call - creates or finds ghost account
      const ghost1 = await ConnectedAccount.findOrCreateGhostAccount(
        context.account.id,
        context.app.id
      );

      expect(ghost1).toBeTruthy();
      expect(ghost1.platform).toBe("ghost");
      expect(ghost1.is_default).toBe(true);

      // Second call - should return the same account
      const ghost2 = await ConnectedAccount.findOrCreateGhostAccount(
        context.account.id,
        context.app.id
      );

      // Third call - should still return the same account
      const ghost3 = await ConnectedAccount.findOrCreateGhostAccount(
        context.account.id,
        context.app.id
      );

      // All should return the same account
      expect(ghost1.id).toBe(ghost2.id);
      expect(ghost2.id).toBe(ghost3.id);

      // Verify only one ghost account exists
      const allGhosts = await ConnectedAccount.query()
        .where("account_id", context.account.id)
        .where("app_id", context.app.id)
        .where("platform", "ghost")
        .where("is_default", true);

      expect(allGhosts).toHaveLength(1);
    });

    it("handles concurrent ghost account creation attempts", async () => {
      const { ConnectedAccount } = await import("#src/models/index.js");

      // Create a new user to test concurrent creation
      const newContext = await createTestContext({ userId: "user_concurrent123" });

      // Delete any existing ghost account for this user
      await ConnectedAccount.query()
        .where("account_id", newContext.account.id)
        .where("app_id", newContext.app.id)
        .where("platform", "ghost")
        .delete();

      // Simulate 5 concurrent calls (race condition)
      const promises = Array(5).fill(null).map(() =>
        ConnectedAccount.findOrCreateGhostAccount(
          newContext.account.id,
          newContext.app.id
        )
      );

      const results = await Promise.all(promises);

      // All should return the same ghost account ID
      const uniqueIds = new Set(results.map(r => r.id));
      expect(uniqueIds.size).toBe(1);

      // Verify only one ghost account exists in the database
      const allGhosts = await ConnectedAccount.query()
        .where("account_id", newContext.account.id)
        .where("app_id", newContext.app.id)
        .where("platform", "ghost")
        .where("is_default", true);

      expect(allGhosts).toHaveLength(1);
    });

    it("prevents ghost account deletion", async () => {
      // Find the ghost account
      const response = await authenticatedRequest(app, "get", "/connections");
      const data = expectSuccessResponse(response);

      const ghostConnection = data.find(c => c.platform === "ghost");
      expect(ghostConnection).toBeTruthy();
      expect(ghostConnection.is_deletable).toBe(false);

      // Try to delete it
      const deleteResponse = await authenticatedRequest(
        app,
        "delete",
        `/connections/${ghostConnection.id}`
      );

      expectErrorResponse(deleteResponse, 403, "cannot be deleted");

      // Verify it still exists
      const verifyResponse = await authenticatedRequest(app, "get", "/connections");
      const verifyData = expectSuccessResponse(verifyResponse);
      const stillExists = verifyData.find(c => c.id === ghostConnection.id);
      expect(stillExists).toBeTruthy();
    });
  });
});
