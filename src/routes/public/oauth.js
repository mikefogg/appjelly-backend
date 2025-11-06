/**
 * OAuth Routes
 * Handles OAuth 2.0 authorization flows for all platforms
 */

import express from "express";
import crypto from "crypto";
import { requireAuth, requireAppContext } from "#src/middleware/index.js";
import { ConnectedAccount, ConnectedAccountAuth } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import { successResponse } from "#src/serializers/index.js";
import { encrypt } from "#src/helpers/encryption.js";
import { ghostQueue, JOB_SYNC_NETWORK, JOB_ANALYZE_STYLE } from "#src/background/queues/index.js";
import twitterOAuth from "#src/services/oauth/TwitterOAuthService.js";
import facebookOAuth from "#src/services/oauth/FacebookOAuthService.js";
import linkedinOAuth from "#src/services/oauth/LinkedInOAuthService.js";

const router = express.Router({ mergeParams: true });

// OAuth service mapping
const oauthServices = {
  twitter: twitterOAuth,
  facebook: facebookOAuth,
  linkedin: linkedinOAuth,
};

// In-memory state storage for OAuth flow
// In production, use Redis or database
const stateStore = new Map();

// In-memory mobile OAuth session storage
// Maps session_token -> { accountId, appId, platform, createdAt }
const mobileOAuthSessions = new Map();

/**
 * Create or update ConnectedAccount and ConnectedAccountAuth
 * Helper to handle the new OAuth architecture
 */
async function createOrUpdateConnection({
  accountId,
  appId,
  platform,
  accessToken,
  refreshToken,
  expiresIn,
  profile,
  oauthService,
  metadata = {},
}) {
  // Check for existing connection
  const existing = await ConnectedAccount.query()
    .where("account_id", accountId)
    .where("app_id", appId)
    .where("platform", platform)
    .withGraphFetched('auth')
    .first();

  // For new connections: check by platform_user_id to handle reconnects
  const existingByUserId = !existing ? await ConnectedAccount.query()
    .where("account_id", accountId)
    .where("app_id", appId)
    .where("platform", platform)
    .whereRaw("profile_data->>'platform_user_id' = ?", [profile.platform_user_id])
    .withGraphFetched('auth')
    .first() : null;

  const conn = existing || existingByUserId;

  if (conn) {
    // Update existing connection
    let authId = conn.connected_account_auth_id;

    // Update or create auth
    if (authId && conn.auth) {
      // Update existing auth
      await ConnectedAccountAuth.query()
        .findById(authId)
        .patch({
          access_token: encrypt(accessToken),
          refresh_token: refreshToken ? encrypt(refreshToken) : conn.auth.refresh_token,
          token_expires_at: oauthService.calculateExpiresAt(expiresIn),
          metadata: {
            ...(conn.auth.metadata || {}),
            platform_user_id: profile.platform_user_id,
            username: profile.username,
            profile_data: profile.profile_data,
          },
          updated_at: new Date().toISOString(),
        });
    } else {
      // Create new auth for existing account
      const newAuth = await ConnectedAccountAuth.query().insert({
        access_token: encrypt(accessToken),
        refresh_token: refreshToken ? encrypt(refreshToken) : null,
        token_expires_at: oauthService.calculateExpiresAt(expiresIn),
        metadata: {
          platform_user_id: profile.platform_user_id,
          username: profile.username,
          profile_data: profile.profile_data,
        },
      });
      authId = newAuth.id;
    }

    // Update connected account
    const updated = await conn.$query().patchAndFetch({
      connected_account_auth_id: authId,
      platform, // In case it was custom before
      label: profile.username,
      username: profile.username,
      display_name: profile.display_name,
      profile_data: profile.profile_data,
      sync_status: "pending",
      is_active: true,
      metadata: {
        ...conn.metadata,
        ...metadata,
        reconnected_at: new Date().toISOString(),
      },
    });

    return updated;
  } else {
    // Create new auth
    const newAuth = await ConnectedAccountAuth.query().insert({
      access_token: encrypt(accessToken),
      refresh_token: refreshToken ? encrypt(refreshToken) : null,
      token_expires_at: oauthService.calculateExpiresAt(expiresIn),
      metadata: {
        platform_user_id: profile.platform_user_id,
        username: profile.username,
        profile_data: profile.profile_data,
      },
    });

    // Create new connection
    const connection = await ConnectedAccount.query().insert({
      account_id: accountId,
      app_id: appId,
      platform,
      connected_account_auth_id: newAuth.id,
      label: profile.username,
      username: profile.username,
      display_name: profile.display_name,
      profile_data: profile.profile_data,
      sync_status: "pending",
      is_active: true,
      metadata,
    });

    return connection;
  }
}

/**
 * Generate and store CSRF state token
 */
function generateState(accountId, appId, platform) {
  const state = crypto.randomBytes(32).toString("hex");
  stateStore.set(state, {
    accountId,
    appId,
    platform,
    createdAt: Date.now(),
  });

  // Clean up old states (older than 10 minutes)
  setTimeout(() => {
    for (const [key, value] of stateStore.entries()) {
      if (Date.now() - value.createdAt > 10 * 60 * 1000) {
        stateStore.delete(key);
      }
    }
  }, 10 * 60 * 1000);

  return state;
}

/**
 * Validate and consume state token
 */
function validateState(state) {
  const data = stateStore.get(state);
  if (!data) {
    throw new Error("Invalid or expired state token");
  }

  // Check if state is too old (10 minutes)
  if (Date.now() - data.createdAt > 10 * 60 * 1000) {
    stateStore.delete(state);
    throw new Error("State token expired");
  }

  // Delete after use (one-time use)
  stateStore.delete(state);
  return data;
}

/**
 * POST /oauth/:platform/mobile-session
 * Creates a session token for mobile OAuth flows
 * Mobile app calls this first, then uses the session_token in the OAuth state parameter
 */
router.post(
  "/:platform/mobile-session",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { platform } = req.params;

      // Validate platform
      const oauthService = oauthServices[platform];
      if (!oauthService) {
        return res.status(400).json(
          formatError(`Unsupported platform: ${platform}`, 400)
        );
      }

      // Generate session token
      const sessionToken = crypto.randomBytes(32).toString("hex");

      // Store session data
      mobileOAuthSessions.set(sessionToken, {
        accountId: res.locals.account.id,
        appId: res.locals.app.id,
        platform,
        createdAt: Date.now(),
      });

      // Clean up old sessions (older than 15 minutes)
      setTimeout(() => {
        for (const [key, value] of mobileOAuthSessions.entries()) {
          if (Date.now() - value.createdAt > 15 * 60 * 1000) {
            mobileOAuthSessions.delete(key);
          }
        }
      }, 15 * 60 * 1000);

      return res.status(200).json(successResponse({
        session_token: sessionToken,
        expires_in: 900, // 15 minutes
      }));
    } catch (error) {
      console.error("Mobile OAuth session error:", error);
      return res.status(500).json(formatError(`Failed to create mobile OAuth session: ${error.message}`));
    }
  }
);

/**
 * GET /oauth/:platform/authorize
 * Initiates OAuth flow - redirects user to platform authorization page
 */
router.get(
  "/:platform/authorize",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { platform } = req.params;

      // Validate platform
      const oauthService = oauthServices[platform];
      if (!oauthService) {
        return res.status(400).json(
          formatError(`Unsupported platform: ${platform}. Supported platforms: twitter, facebook, linkedin`, 400)
        );
      }

      // Generate CSRF state token
      const state = generateState(
        res.locals.account.id,
        res.locals.app.id,
        platform
      );

      // Get authorization URL
      const authUrl = oauthService.getAuthorizationUrl(state);

      // Return URL for client to redirect to
      return res.status(200).json(successResponse({
        authorization_url: authUrl,
        state,
      }));
    } catch (error) {
      console.error("OAuth authorize error:", error);
      return res.status(500).json(formatError(`Failed to initiate OAuth: ${error.message}`));
    }
  }
);

/**
 * GET /oauth/:platform/callback
 * OAuth callback endpoint - handles authorization code exchange
 */
router.get(
  "/:platform/callback",
  async (req, res) => {
    try {
      const { platform } = req.params;
      const { code, state, error, error_description } = req.query;

      // Check for OAuth errors
      if (error) {
        console.error("OAuth callback error:", error, error_description);

        // For LinkedIn mobile flow, redirect to app with error
        if (platform === "linkedin" && !state) {
          const errorMessage = encodeURIComponent(error_description || error);
          return res.redirect(`ghostapp://oauth?error=${errorMessage}&platform=linkedin`);
        }

        return res.status(400).json(
          formatError(`OAuth authorization failed: ${error_description || error}`, 400)
        );
      }

      // Validate platform
      const oauthService = oauthServices[platform];
      if (!oauthService) {
        return res.status(400).json(
          formatError(`Unsupported platform: ${platform}`, 400)
        );
      }

      // Check if this is a mobile OAuth session
      const mobileSession = state ? mobileOAuthSessions.get(state) : null;
      const isMobileOAuthFlow = platform === "linkedin" && mobileSession;

      if (isMobileOAuthFlow) {
        // Validate session hasn't expired
        if (Date.now() - mobileSession.createdAt > 15 * 60 * 1000) {
          mobileOAuthSessions.delete(state);
          return res.redirect(`ghostapp://oauth?error=${encodeURIComponent("OAuth session expired")}&platform=linkedin`);
        }

        // Validate code parameter
        if (!code) {
          const errorMessage = encodeURIComponent("Missing authorization code");
          return res.redirect(`ghostapp://oauth?error=${errorMessage}&platform=linkedin`);
        }

        try {
          // Exchange code for tokens (backend handles this with client_secret)
          const tokenData = await oauthService.exchangeCodeForToken(code);

          // Get user profile
          const profile = await oauthService.getUserProfile(tokenData.access_token);

          // Create or update connection
          const connection = await createOrUpdateConnection({
            accountId: mobileSession.accountId,
            appId: mobileSession.appId,
            platform,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresIn: tokenData.expires_in,
            profile,
            oauthService,
            metadata: {
              connection_method: "mobile_oauth",
            },
          });

          // Trigger background sync jobs (don't await - let them run async)
          ghostQueue.add(JOB_SYNC_NETWORK, {
            connectedAccountId: connection.id,
          }).catch(err => console.error("Failed to queue sync job:", err));

          ghostQueue.add(JOB_ANALYZE_STYLE, {
            connectedAccountId: connection.id,
          }).catch(err => console.error("Failed to queue analyze job:", err));

          // Clean up session
          mobileOAuthSessions.delete(state);

          // Redirect to mobile app with success
          return res.redirect(`ghostapp://oauth?success=true&platform=linkedin&connection_id=${connection.id}`);
        } catch (error) {
          console.error("LinkedIn mobile OAuth error:", error);
          mobileOAuthSessions.delete(state);
          const errorMessage = encodeURIComponent(error.message || "OAuth failed");
          return res.redirect(`ghostapp://oauth?error=${errorMessage}&platform=linkedin`);
        }
      }

      // Web OAuth flow (with state validation) for all other cases
      // Validate required parameters
      if (!code || !state) {
        return res.status(400).json(
          formatError("Missing required OAuth parameters", 400)
        );
      }

      // Validate and consume state token
      let stateData;
      try {
        stateData = validateState(state);
      } catch (error) {
        return res.status(400).json(formatError(error.message, 400));
      }

      // Exchange code for tokens
      const tokenData = await oauthService.exchangeCodeForToken(code);

      // For Facebook, exchange for long-lived token
      let accessToken = tokenData.access_token;
      let expiresIn = tokenData.expires_in;

      if (platform === "facebook" && accessToken) {
        try {
          const longLivedToken = await oauthService.exchangeForLongLivedToken(accessToken);
          accessToken = longLivedToken.access_token;
          expiresIn = longLivedToken.expires_in;
        } catch (error) {
          console.warn("Failed to exchange for long-lived Facebook token:", error);
          // Continue with short-lived token
        }
      }

      // Fetch user profile
      const profile = await oauthService.getUserProfile(accessToken);

      // Create or update connection
      const connection = await createOrUpdateConnection({
        accountId: stateData.accountId,
        appId: stateData.appId,
        platform,
        accessToken,
        refreshToken: tokenData.refresh_token,
        expiresIn,
        profile,
        oauthService,
        metadata: {
          connection_method: "web_oauth",
        },
      });

      // Trigger background sync jobs in parallel
      await Promise.all([
        ghostQueue.add(JOB_SYNC_NETWORK, {
          connectedAccountId: connection.id,
        }),
        ghostQueue.add(JOB_ANALYZE_STYLE, {
          connectedAccountId: connection.id,
        }),
      ]);

      // Return success response
      // In a real app, redirect to a success page
      return res.status(200).json({
        id: connection.id,
        platform: connection.platform,
        label: connection.label,
        username: connection.username,
        is_connected: !!connection.connected_account_auth_id,
        sync_status: connection.sync_status,
        last_synced_at: connection.last_synced_at,
        created_at: connection.created_at,
      });
    } catch (error) {
      console.error("OAuth callback error:", error);
      return res.status(500).json(
        formatError(`OAuth callback failed: ${error.message}`)
      );
    }
  }
);

/**
 * POST /oauth/:platform/connect
 * Direct token connection endpoint for native OAuth (expo-auth-session)
 * Use this when the client handles OAuth natively and already has tokens
 */
router.post(
  "/:platform/connect",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { platform } = req.params;
      const { access_token, refresh_token, expires_in } = req.body;

      // Validate platform
      const oauthService = oauthServices[platform];
      if (!oauthService) {
        return res.status(400).json(
          formatError(`Unsupported platform: ${platform}. Supported platforms: twitter, facebook, linkedin`, 400)
        );
      }

      // Validate required parameters
      if (!access_token) {
        return res.status(400).json(
          formatError("access_token is required", 400)
        );
      }

      // For Facebook, try to exchange for long-lived token
      let finalAccessToken = access_token;
      let finalExpiresIn = expires_in;

      if (platform === "facebook" && access_token) {
        try {
          const longLivedToken = await oauthService.exchangeForLongLivedToken(access_token);
          finalAccessToken = longLivedToken.access_token;
          finalExpiresIn = longLivedToken.expires_in;
        } catch (error) {
          console.warn("Failed to exchange for long-lived Facebook token:", error);
          // Continue with provided token
        }
      }

      // Fetch user profile
      const profile = await oauthService.getUserProfile(finalAccessToken);

      // Create or update connection
      const connection = await createOrUpdateConnection({
        accountId: res.locals.account.id,
        appId: res.locals.app.id,
        platform,
        accessToken: finalAccessToken,
        refreshToken: refresh_token,
        expiresIn: finalExpiresIn,
        profile,
        oauthService,
        metadata: {
          connection_method: "native_oauth",
        },
      });

      // Trigger background sync jobs in parallel
      await Promise.all([
        ghostQueue.add(JOB_SYNC_NETWORK, {
          connectedAccountId: connection.id,
        }),
        ghostQueue.add(JOB_ANALYZE_STYLE, {
          connectedAccountId: connection.id,
        }),
      ]);

      // Return success response
      return res.status(201).json({
        id: connection.id,
        platform: connection.platform,
        label: connection.label,
        username: connection.username,
        is_connected: !!connection.connected_account_auth_id,
        sync_status: connection.sync_status,
        last_synced_at: connection.last_synced_at,
        created_at: connection.created_at,
      });
    } catch (error) {
      console.error("OAuth connect error:", error);
      return res.status(500).json(
        formatError(`Failed to connect account: ${error.message}`)
      );
    }
  }
);

/**
 * GET /oauth/connections
 * List all OAuth connections for current user
 */
router.get(
  "/connections",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const connections = await ConnectedAccount.query()
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .where("is_active", true)
        .orderBy("created_at", "desc");

      const data = connections.map(conn => ({
        id: conn.id,
        platform: conn.platform,
        label: conn.label, // User-facing name (e.g., "Personal Twitter", "@handle", "My Blog")
        username: conn.username, // Platform username (e.g., "@johndoe")
        is_connected: !!conn.connected_account_auth_id,
        sync_status: conn.sync_status,
        last_synced_at: conn.last_synced_at,
        created_at: conn.created_at,
      }));

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get OAuth connections error:", error);
      return res.status(500).json(formatError("Failed to retrieve connections"));
    }
  }
);

/**
 * POST /oauth/accounts
 * Create a manual (non-OAuth) account
 * Allows users to create accounts without connecting OAuth
 */
router.post(
  "/accounts",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { platform, label, username } = req.body;

      // Validate required fields
      if (!label || label.trim().length === 0) {
        return res.status(400).json(
          formatError("label is required", 400)
        );
      }

      // Validate platform if provided
      const validPlatforms = ["twitter", "linkedin", "threads", "facebook", "ghost", "custom", null];
      if (platform && !validPlatforms.includes(platform)) {
        return res.status(400).json(
          formatError(`Invalid platform. Supported: ${validPlatforms.filter(p => p).join(", ")}`, 400)
        );
      }

      // Create manual account
      const account = await ConnectedAccount.query().insert({
        account_id: res.locals.account.id,
        app_id: res.locals.app.id,
        platform: platform || "custom",
        label: label.trim(),
        username: username?.trim() || null,
        connected_account_auth_id: null, // Manual account - no OAuth
        sync_status: "ready", // Manual accounts are always "ready"
        is_active: true,
        metadata: {
          connection_method: "manual",
          created_at: new Date().toISOString(),
        },
      });

      return res.status(201).json({
        id: account.id,
        platform: account.platform,
        label: account.label,
        username: account.username,
        is_connected: false,
        sync_status: account.sync_status,
        last_synced_at: account.last_synced_at,
        created_at: account.created_at,
      });
    } catch (error) {
      console.error("Create manual account error:", error);
      return res.status(500).json(
        formatError(`Failed to create account: ${error.message}`)
      );
    }
  }
);

/**
 * PATCH /oauth/accounts/:id
 * Update an existing account
 * Platform can only be changed for manual (non-connected) accounts
 */
router.patch(
  "/accounts/:id",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { platform, label, username } = req.body;

      // Find account
      const account = await ConnectedAccount.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!account) {
        return res.status(404).json(
          formatError("Account not found", 404)
        );
      }

      // Build update object
      const updates = {};

      if (label !== undefined) {
        if (label.trim().length === 0) {
          return res.status(400).json(
            formatError("label cannot be empty", 400)
          );
        }
        updates.label = label.trim();
      }

      if (username !== undefined) {
        updates.username = username?.trim() || null;
      }

      if (platform !== undefined) {
        // Validate platform change
        if (account.connected_account_auth_id) {
          return res.status(400).json(
            formatError("Cannot change platform for connected accounts. Disconnect first.", 400)
          );
        }

        const validPlatforms = ["twitter", "linkedin", "threads", "facebook", "ghost", "custom", null];
        if (platform && !validPlatforms.includes(platform)) {
          return res.status(400).json(
            formatError(`Invalid platform. Supported: ${validPlatforms.filter(p => p).join(", ")}`, 400)
          );
        }

        updates.platform = platform || "custom";
      }

      // Update account
      const updated = await account.$query().patchAndFetch(updates);

      return res.status(200).json({
        id: updated.id,
        platform: updated.platform,
        label: updated.label,
        username: updated.username,
        is_connected: !!updated.connected_account_auth_id,
        sync_status: updated.sync_status,
        last_synced_at: updated.last_synced_at,
        created_at: updated.created_at,
      });
    } catch (error) {
      console.error("Update account error:", error);

      // Check if it's the platform lock validation error from model
      if (error.message && error.message.includes("Cannot change platform")) {
        return res.status(400).json(formatError(error.message, 400));
      }

      return res.status(500).json(
        formatError(`Failed to update account: ${error.message}`)
      );
    }
  }
);

/**
 * DELETE /oauth/accounts/:id
 * Delete (soft delete) an account
 */
router.delete(
  "/accounts/:id",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Find account
      const account = await ConnectedAccount.query()
        .findById(id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!account) {
        return res.status(404).json(
          formatError("Account not found", 404)
        );
      }

      if (!account.is_deletable) {
        return res.status(400).json(
          formatError("This account cannot be deleted", 400)
        );
      }

      // Soft delete by marking as inactive
      await account.$query().patch({
        is_active: false,
        metadata: {
          ...account.metadata,
          deleted_at: new Date().toISOString(),
        },
      });

      return res.status(200).json(successResponse({
        message: "Account deleted successfully",
      }));
    } catch (error) {
      console.error("Delete account error:", error);
      return res.status(500).json(
        formatError(`Failed to delete account: ${error.message}`)
      );
    }
  }
);

export default router;
