import BaseModel from "#src/models/BaseModel.js";
import Account from "#src/models/Account.js";
import App from "#src/models/App.js";
import NetworkProfile from "#src/models/NetworkProfile.js";
import NetworkPost from "#src/models/NetworkPost.js";
import PostSuggestion from "#src/models/PostSuggestion.js";
import WritingStyle from "#src/models/WritingStyle.js";
import UserPostHistory from "#src/models/UserPostHistory.js";
import SamplePost from "#src/models/SamplePost.js";
import { decrypt } from "#src/helpers/encryption.js";

class ConnectedAccount extends BaseModel {
  static get tableName() {
    return "connected_accounts";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["account_id", "app_id", "platform", "username"],
      properties: {
        ...super.jsonSchema.properties,
        account_id: { type: "string", format: "uuid" },
        app_id: { type: "string", format: "uuid" },
        platform: { type: "string", enum: ["twitter", "facebook", "linkedin", "threads", "ghost"] },
        platform_user_id: { type: ["string", "null"], minLength: 1 },
        username: { type: "string", minLength: 1 },
        display_name: { type: ["string", "null"] },
        access_token: { type: ["string", "null"], minLength: 1 },
        refresh_token: { type: ["string", "null"] },
        token_expires_at: { type: ["string", "null"], format: "date-time" },
        profile_data: { type: "object" },
        last_synced_at: { type: ["string", "null"], format: "date-time" },
        last_analyzed_at: { type: ["string", "null"], format: "date-time" },
        sync_status: {
          type: "string",
          enum: ["pending", "syncing", "ready", "error"],
          default: "pending"
        },
        is_active: { type: "boolean", default: true },
        is_default: { type: "boolean", default: false },
        is_deletable: { type: "boolean", default: true },
        voice: { type: ["string", "null"] },
        topics_of_interest: { type: ["string", "null"] },
        metadata: { type: "object" },
      },
    };
  }

  static get relationMappings() {
    return {
      account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Account,
        join: {
          from: "connected_accounts.account_id",
          to: "accounts.id",
        },
      },
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "connected_accounts.app_id",
          to: "apps.id",
        },
      },
      network_profiles: {
        relation: BaseModel.HasManyRelation,
        modelClass: NetworkProfile,
        join: {
          from: "connected_accounts.id",
          to: "network_profiles.connected_account_id",
        },
      },
      network_posts: {
        relation: BaseModel.HasManyRelation,
        modelClass: NetworkPost,
        join: {
          from: "connected_accounts.id",
          to: "network_posts.connected_account_id",
        },
      },
      post_suggestions: {
        relation: BaseModel.HasManyRelation,
        modelClass: PostSuggestion,
        join: {
          from: "connected_accounts.id",
          to: "post_suggestions.connected_account_id",
        },
      },
      writing_style: {
        relation: BaseModel.HasOneRelation,
        modelClass: WritingStyle,
        join: {
          from: "connected_accounts.id",
          to: "writing_styles.connected_account_id",
        },
      },
      user_post_history: {
        relation: BaseModel.HasManyRelation,
        modelClass: UserPostHistory,
        join: {
          from: "connected_accounts.id",
          to: "user_post_history.connected_account_id",
        },
      },
      sample_posts: {
        relation: BaseModel.HasManyRelation,
        modelClass: SamplePost,
        join: {
          from: "connected_accounts.id",
          to: "sample_posts.connected_account_id",
        },
      },
    };
  }

  static async findByAccountAndApp(accountId, appId) {
    return this.query()
      .where("account_id", accountId)
      .where("app_id", appId)
      .where("is_active", true)
      .orderBy("created_at", "desc");
  }

  static async findByPlatform(accountId, appId, platform) {
    return this.query()
      .where("account_id", accountId)
      .where("app_id", appId)
      .where("platform", platform)
      .where("is_active", true)
      .orderBy("created_at", "desc");
  }

  /**
   * Find or create the default ghost account for a user
   * Ghost account is used for standalone posts (not tied to social platforms)
   */
  static async findOrCreateGhostAccount(accountId, appId) {
    // Try to find existing ghost account
    const existing = await this.query()
      .where("account_id", accountId)
      .where("app_id", appId)
      .where("platform", "ghost")
      .where("is_default", true)
      .first();

    if (existing) {
      return existing;
    }

    // Create new ghost account
    try {
      return await this.query().insert({
        account_id: accountId,
        app_id: appId,
        platform: "ghost",
        platform_user_id: null,
        username: "My Drafts",
        display_name: "My Drafts",
        access_token: null,
        sync_status: "ready", // Ghost accounts are always ready
        is_default: true,
        is_deletable: false,
        is_active: true,
        metadata: {
          created_reason: "default_ghost_account",
          created_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      // If unique constraint violation (race condition), fetch the existing account
      // Check both raw PostgreSQL error code and db-errors wrapped error
      const isUniqueViolation =
        error.code === "23505" || // Raw PostgreSQL error
        error.constraint === "connected_accounts_unique_default_ghost" || // db-errors constraint name
        error.name === "UniqueViolationError"; // db-errors error name

      if (isUniqueViolation) {
        const existing = await this.query()
          .where("account_id", accountId)
          .where("app_id", appId)
          .where("platform", "ghost")
          .where("is_default", true)
          .first();

        if (existing) {
          return existing;
        }
      }
      // Re-throw if it's a different error
      throw error;
    }
  }

  async markAsSyncing() {
    return this.$query().patchAndFetch({
      sync_status: "syncing",
      metadata: {
        ...this.metadata,
        sync_started_at: new Date().toISOString(),
      },
    });
  }

  async markAsReady() {
    return this.$query().patchAndFetch({
      sync_status: "ready",
      last_synced_at: new Date().toISOString(),
      metadata: {
        ...this.metadata,
        last_sync_completed_at: new Date().toISOString(),
      },
    });
  }

  async markAsError(error) {
    return this.$query().patchAndFetch({
      sync_status: "error",
      metadata: {
        ...this.metadata,
        last_error: error.message,
        error_at: new Date().toISOString(),
      },
    });
  }

  needsSync(hoursThreshold = 24) {
    if (!this.last_synced_at) return true;
    const hoursSinceSync = (new Date() - new Date(this.last_synced_at)) / (1000 * 60 * 60);
    return hoursSinceSync >= hoursThreshold;
  }

  needsAnalysis(daysThreshold = 7) {
    if (!this.last_analyzed_at) return true;
    const daysSinceAnalysis = (new Date() - new Date(this.last_analyzed_at)) / (1000 * 60 * 60 * 24);
    return daysSinceAnalysis >= daysThreshold;
  }

  static get modifiers() {
    return {
      active(builder) {
        builder.where("is_active", true);
      },
      ready(builder) {
        builder.where("sync_status", "ready");
      },
      needsSync(builder, hoursThreshold = 24) {
        const threshold = new Date();
        threshold.setHours(threshold.getHours() - hoursThreshold);
        builder.where((qb) => {
          qb.whereNull("last_synced_at").orWhere("last_synced_at", "<", threshold.toISOString());
        });
      },
    };
  }

  /**
   * Get decrypted access token
   * Tokens are stored encrypted in database
   */
  getDecryptedAccessToken() {
    if (!this.access_token) return null;
    try {
      return decrypt(this.access_token);
    } catch (error) {
      console.error("Failed to decrypt access token:", error);
      return null;
    }
  }

  /**
   * Get decrypted refresh token
   * Tokens are stored encrypted in database
   */
  getDecryptedRefreshToken() {
    if (!this.refresh_token) return null;
    try {
      return decrypt(this.refresh_token);
    } catch (error) {
      console.error("Failed to decrypt refresh token:", error);
      return null;
    }
  }

  /**
   * Check if access token is expired
   */
  isTokenExpired() {
    if (!this.token_expires_at) return false;
    return new Date() >= new Date(this.token_expires_at);
  }

  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string|null>} Valid access token
   */
  async getValidAccessToken() {
    // Check if token exists
    const currentToken = this.getDecryptedAccessToken();
    if (!currentToken) {
      console.warn(`[ConnectedAccount] No access token for account ${this.id}`);
      return null;
    }

    // Check if token is expired
    if (!this.isTokenExpired()) {
      // Token is still valid
      return currentToken;
    }

    console.log(`[ConnectedAccount] Access token expired for account ${this.id}, attempting refresh...`);

    // Check if we have a refresh token
    const refreshToken = this.getDecryptedRefreshToken();
    if (!refreshToken) {
      console.warn(`[ConnectedAccount] No refresh token available for account ${this.id}`);
      // Mark account as needing re-authentication
      await this.$query().patch({
        sync_status: "error",
        metadata: {
          ...this.metadata,
          error: "Token expired and no refresh token available",
          error_at: new Date().toISOString(),
        },
      });
      return null;
    }

    try {
      // Import OAuth services dynamically to avoid circular dependencies
      const { default: twitterOAuth } = await import("#src/services/oauth/TwitterOAuthService.js");
      const { default: facebookOAuth } = await import("#src/services/oauth/FacebookOAuthService.js");
      const { default: linkedinOAuth } = await import("#src/services/oauth/LinkedInOAuthService.js");

      const oauthServices = {
        twitter: twitterOAuth,
        facebook: facebookOAuth,
        linkedin: linkedinOAuth,
      };

      const oauthService = oauthServices[this.platform];
      if (!oauthService) {
        console.warn(`[ConnectedAccount] No OAuth service for platform ${this.platform}`);
        return null;
      }

      // Refresh the token
      const tokenData = await oauthService.refreshAccessToken(refreshToken);

      // Import encrypt function
      const { encrypt } = await import("#src/helpers/encryption.js");

      // Update the token in the database
      await this.$query().patch({
        access_token: encrypt(tokenData.access_token),
        refresh_token: tokenData.refresh_token ? encrypt(tokenData.refresh_token) : this.refresh_token,
        token_expires_at: oauthService.calculateExpiresAt(tokenData.expires_in),
        metadata: {
          ...this.metadata,
          last_token_refresh: new Date().toISOString(),
        },
      });

      console.log(`[ConnectedAccount] Token refreshed successfully for account ${this.id}`);

      return tokenData.access_token;
    } catch (error) {
      console.error(`[ConnectedAccount] Failed to refresh token for account ${this.id}:`, error.message);

      // Mark account as needing re-authentication
      await this.$query().patch({
        sync_status: "error",
        metadata: {
          ...this.metadata,
          error: `Token refresh failed: ${error.message}`,
          error_at: new Date().toISOString(),
        },
      });

      return null;
    }
  }
}

export default ConnectedAccount;
