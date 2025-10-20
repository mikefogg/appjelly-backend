import { describe, it, expect, beforeEach, vi } from "vitest";
import app from "#src/index.js";
import {
  expectSuccessResponse,
  expectErrorResponse,
  expectUnauthenticatedError,
} from "../../helpers/assertions.js";
import {
  authenticatedRequest,
  unauthenticatedRequest,
} from "../../helpers/ghost-helpers.js";
import mockFetch from "../../test-utils/mockFetch.js";

// Mock ghostQueue
vi.mock("#src/background/queues/index.js", async () => {
  const actual = await vi.importActual("#src/background/queues/index.js");
  return {
    ...actual,
    ghostQueue: {
      add: vi.fn().mockResolvedValue({ id: "job_123" }),
    },
  };
});

describe("OAuth Routes", () => {
  let context;

  beforeEach(async () => {
    // Create context WITHOUT a connected account for OAuth tests
    const { createGhostApp, createAccount } = await import("../../helpers/ghost-helpers.js");
    const app = await createGhostApp();
    const account = await createAccount(app, { clerk_id: "user_test123" });

    context = {
      app,
      account,
    };

    vi.clearAllMocks();
    mockFetch.reset();
  });

  describe("GET /oauth/:platform/authorize", () => {
    it("returns authorization URL for Twitter", async () => {
      const response = await authenticatedRequest(app, "get", "/oauth/twitter/authorize");

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("authorization_url");
      expect(data).toHaveProperty("state");
      expect(data.authorization_url).toContain("twitter.com");
      expect(data.authorization_url).toContain(`state=${data.state}`);
      expect(data.authorization_url).toContain("client_id");
      expect(data.authorization_url).toContain("redirect_uri");
      expect(data.authorization_url).toContain("response_type=code");
    });

    it("returns authorization URL for Facebook", async () => {
      const response = await authenticatedRequest(app, "get", "/oauth/facebook/authorize");

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("authorization_url");
      expect(data).toHaveProperty("state");
      expect(data.authorization_url).toContain("facebook.com");
      expect(data.authorization_url).toContain("v18.0");
    });

    it("returns authorization URL for LinkedIn", async () => {
      const response = await authenticatedRequest(app, "get", "/oauth/linkedin/authorize");

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("authorization_url");
      expect(data.authorization_url).toContain("linkedin.com");
    });

    it("returns 400 for unsupported platform", async () => {
      const response = await authenticatedRequest(app, "get", "/oauth/tiktok/authorize");

      expectErrorResponse(response, 400, "Unsupported platform");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "get", "/oauth/twitter/authorize");

      expectUnauthenticatedError(response);
    });

    it("includes required OAuth scopes in URL", async () => {
      const response = await authenticatedRequest(app, "get", "/oauth/twitter/authorize");

      const data = expectSuccessResponse(response);
      expect(data.authorization_url).toContain("scope=");
      expect(data.authorization_url).toContain("tweet.read");
      expect(data.authorization_url).toContain("users.read");
    });

    it("generates unique state tokens", async () => {
      const response1 = await authenticatedRequest(app, "get", "/oauth/twitter/authorize");
      const response2 = await authenticatedRequest(app, "get", "/oauth/twitter/authorize");

      const data1 = expectSuccessResponse(response1);
      const data2 = expectSuccessResponse(response2);

      expect(data1.state).not.toBe(data2.state);
    });
  });

  describe("GET /oauth/:platform/callback", () => {
    it("returns 400 when OAuth error is returned", async () => {
      const response = await unauthenticatedRequest(
        app,
        "get",
        "/oauth/twitter/callback?error=access_denied&error_description=User%20cancelled"
      );

      expectErrorResponse(response, 400, "User cancelled");
    });

    it("returns 400 for missing code parameter", async () => {
      const response = await unauthenticatedRequest(
        app,
        "get",
        "/oauth/twitter/callback?state=some_state"
      );

      expectErrorResponse(response, 400, "Missing required OAuth parameters");
    });

    it("returns 400 for missing state parameter", async () => {
      const response = await unauthenticatedRequest(
        app,
        "get",
        "/oauth/twitter/callback?code=some_code"
      );

      expectErrorResponse(response, 400, "Missing required OAuth parameters");
    });

    it("returns 400 for invalid state token", async () => {
      const response = await unauthenticatedRequest(
        app,
        "get",
        "/oauth/twitter/callback?code=auth_code_123&state=invalid_state"
      );

      expectErrorResponse(response, 400, "Invalid or expired state token");
    });

    it("returns 400 for unsupported platform", async () => {
      const response = await unauthenticatedRequest(
        app,
        "get",
        "/oauth/invalid_platform/callback?code=code&state=state"
      );

      expectErrorResponse(response, 400, "Unsupported platform");
    });

    /**
     * Note: Full OAuth callback flow with token exchange requires E2E/integration testing
     * with real OAuth providers or sophisticated mocking. The tests above cover error handling.
     *
     * For manual testing:
     * 1. GET /oauth/twitter/authorize → get authorization_url
     * 2. Open URL in browser and authorize
     * 3. Platform redirects to callback with code and state
     * 4. Callback exchanges code for tokens and creates connection
     */
  });

  describe("GET /oauth/connections", () => {
    it("returns only ghost account when no OAuth connections exist", async () => {
      const response = await authenticatedRequest(app, "get", "/oauth/connections");

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1); // Ghost account is auto-created
      expect(data[0].platform).toBe("ghost");
    });

    it("returns all active connections for user", async () => {
      // Create multiple connections
      const { ConnectedAccount } = await import("#src/models/index.js");
      const { encrypt } = await import("#src/helpers/encryption.js");

      await ConnectedAccount.query().insert([
        {
          account_id: context.account.id,
          app_id: context.app.id,
          platform: "twitter",
          platform_user_id: "twitter_456",
          username: "twitteruser",
          display_name: "Twitter User",
          access_token: encrypt("test_token_1"),
          sync_status: "ready",
          is_active: true,
        },
        {
          account_id: context.account.id,
          app_id: context.app.id,
          platform: "linkedin",
          platform_user_id: "linkedin_789",
          username: "linkedinuser",
          display_name: "LinkedIn User",
          access_token: encrypt("test_token_2"),
          sync_status: "ready",
          is_active: true,
        },
      ]);

      const response = await authenticatedRequest(app, "get", "/oauth/connections");

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(3); // 2 OAuth connections + 1 ghost account

      // Verify all connections have expected properties
      data.forEach(conn => {
        expect(conn).toHaveProperty("platform");
        expect(conn).toHaveProperty("username");
        expect(conn).toHaveProperty("sync_status");
        expect(conn).not.toHaveProperty("access_token"); // Should not expose tokens
      });
    });

    it("filters out inactive connections", async () => {
      const { ConnectedAccount } = await import("#src/models/index.js");
      const { encrypt } = await import("#src/helpers/encryption.js");

      await ConnectedAccount.query().insert([
        {
          account_id: context.account.id,
          app_id: context.app.id,
          platform: "twitter",
          platform_user_id: "twitter_active",
          username: "activeuser",
          access_token: encrypt("token"),
          is_active: true,
        },
        {
          account_id: context.account.id,
          app_id: context.app.id,
          platform: "facebook",
          platform_user_id: "facebook_inactive",
          username: "inactiveuser",
          access_token: encrypt("token"),
          is_active: false,
        },
      ]);

      const response = await authenticatedRequest(app, "get", "/oauth/connections");

      const data = expectSuccessResponse(response);
      expect(data.length).toBe(2); // 1 active OAuth connection + 1 ghost account

      // Verify active user is present
      const activeUser = data.find(c => c.username === "activeuser");
      expect(activeUser).toBeTruthy();

      // Verify inactive user is not present
      const inactiveUser = data.find(c => c.username === "inactiveuser");
      expect(inactiveUser).toBeUndefined();
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "get", "/oauth/connections");

      expectUnauthenticatedError(response);
    });
  });

  describe("POST /oauth/:platform/connect", () => {
    it("creates connection with provided tokens (Twitter)", async () => {
      // Mock the getUserProfile call
      mockFetch.setup();
      mockFetch.mockUrl("https://api.twitter.com/2/users/me", {
        data: {
          id: "twitter_native_123",
          username: "nativeuser",
          name: "Native User",
        },
      });

      const response = await authenticatedRequest(app, "post", "/oauth/twitter/connect")
        .send({
          access_token: "native_twitter_token",
          refresh_token: "native_refresh_token",
          expires_in: 7200,
        });

      const data = expectSuccessResponse(response, 201);
      expect(data.message).toContain("Successfully connected");
      expect(data.connection).toHaveProperty("id");
      expect(data.connection.platform).toBe("twitter");
      expect(data.connection.username).toBe("nativeuser");
      expect(data.connection.sync_status).toBe("pending");

      // Verify connection was created in database
      const { ConnectedAccount } = await import("#src/models/index.js");
      const connection = await ConnectedAccount.query().findById(data.connection.id);
      expect(connection).toBeTruthy();
      expect(connection.platform_user_id).toBe("twitter_native_123");
      expect(connection.metadata.connection_method).toBe("native_oauth");

      mockFetch.reset();
    });

    it("updates existing connection if already connected", async () => {
      // Create existing connection
      const { ConnectedAccount } = await import("#src/models/index.js");
      const { encrypt } = await import("#src/helpers/encryption.js");

      const existing = await ConnectedAccount.query().insert({
        account_id: context.account.id,
        app_id: context.app.id,
        platform: "twitter",
        platform_user_id: "twitter_update_456",
        username: "oldusername",
        display_name: "Old Name",
        access_token: encrypt("old_token"),
        sync_status: "ready",
        is_active: true,
      });

      // Mock the getUserProfile call with same platform_user_id
      mockFetch.setup();
      mockFetch.mockUrl("https://api.twitter.com/2/users/me", {
        data: {
          id: "twitter_update_456",
          username: "updatedusername",
          name: "Updated Name",
        },
      });

      const response = await authenticatedRequest(app, "post", "/oauth/twitter/connect")
        .send({
          access_token: "new_twitter_token",
          refresh_token: "new_refresh_token",
          expires_in: 7200,
        });

      const data = expectSuccessResponse(response, 201);
      expect(data.connection.id).toBe(existing.id);
      expect(data.connection.username).toBe("updatedusername");

      // Verify connection was updated
      const updated = await ConnectedAccount.query().findById(existing.id);
      expect(updated.username).toBe("updatedusername");
      expect(updated.display_name).toBe("Updated Name");
      expect(updated.metadata.reconnected_at).toBeTruthy();

      mockFetch.reset();
    });

    it("returns 400 when access_token is missing", async () => {
      const response = await authenticatedRequest(app, "post", "/oauth/twitter/connect")
        .send({
          refresh_token: "refresh_token",
        });

      expectErrorResponse(response, 400, "access_token is required");
    });

    it("returns 400 for unsupported platform", async () => {
      const response = await authenticatedRequest(app, "post", "/oauth/tiktok/connect")
        .send({
          access_token: "token",
        });

      expectErrorResponse(response, 400, "Unsupported platform");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "post", "/oauth/twitter/connect")
        .send({
          access_token: "token",
        });

      expectUnauthenticatedError(response);
    });

    it("handles Facebook long-lived token exchange", async () => {
      // Mock getUserProfile
      mockFetch.setup();
      mockFetch.mockUrl("https://graph.facebook.com/v18.0/me*", {
        id: "facebook_native_789",
        name: "Facebook User",
        email: "fb@example.com",
      });

      // Mock long-lived token exchange
      mockFetch.mockUrl("https://graph.facebook.com/v18.0/oauth/access_token*", {
        access_token: "long_lived_facebook_token",
        expires_in: 5184000, // 60 days
      });

      const response = await authenticatedRequest(app, "post", "/oauth/facebook/connect")
        .send({
          access_token: "short_lived_facebook_token",
          expires_in: 3600,
        });

      const data = expectSuccessResponse(response, 201);
      expect(data.connection.platform).toBe("facebook");

      mockFetch.reset();
    });

    it("accepts optional expires_in parameter", async () => {
      mockFetch.setup();
      mockFetch.mockUrl("https://api.twitter.com/2/users/me", {
        data: {
          id: "twitter_expires_999",
          username: "expiresuser",
          name: "Expires User",
        },
      });

      const response = await authenticatedRequest(app, "post", "/oauth/twitter/connect")
        .send({
          access_token: "token_with_expiry",
          // No expires_in provided
        });

      const data = expectSuccessResponse(response, 201);
      expect(data.connection).toHaveProperty("id");

      mockFetch.reset();
    });
  });
});
