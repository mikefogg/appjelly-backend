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
      expect(data).toHaveLength(1);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("platform", "twitter");
      expect(data[0]).toHaveProperty("username", "testuser");
      expect(data[0]).toHaveProperty("sync_status", "ready");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "get", "/connections");
      expectUnauthenticatedError(response);
    });

    it("returns empty array when no connections", async () => {
      // Create new context without connected account
      const { app: newApp, account } = await createTestContext({
        userId: "user_different123",
      });

      // Delete the connected account
      await context.connectedAccount.$query().delete();

      const response = await authenticatedRequest(app, "get", "/connections");

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
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

      // Verify jobs were queued
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
        }),
        expect.objectContaining({
          delay: 30000,
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
});
