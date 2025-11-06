import BaseModel from "#src/models/BaseModel.js";
import Account from "#src/models/Account.js";
import App from "#src/models/App.js";
import NetworkProfile from "#src/models/NetworkProfile.js";
import NetworkPost from "#src/models/NetworkPost.js";
import PostSuggestion from "#src/models/PostSuggestion.js";
import UserTopicPreference from "#src/models/UserTopicPreference.js";
import WritingStyle from "#src/models/WritingStyle.js";
import UserPostHistory from "#src/models/UserPostHistory.js";
import SamplePost from "#src/models/SamplePost.js";
import Rule from "#src/models/Rule.js";
import ConnectedAccountAuth from "#src/models/ConnectedAccountAuth.js";
import { decrypt, encrypt } from "#src/helpers/encryption.js";
import twitterOAuth from "#src/services/oauth/TwitterOAuthService.js";
import facebookOAuth from "#src/services/oauth/FacebookOAuthService.js";
import linkedinOAuth from "#src/services/oauth/LinkedInOAuthService.js";

class ConnectedAccount extends BaseModel {
  static get tableName() {
    return "connected_accounts";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["account_id", "app_id"],
      properties: {
        ...super.jsonSchema.properties,
        account_id: { type: "string", format: "uuid" },
        app_id: { type: "string", format: "uuid" },
        platform: {
          type: ["string", "null"],
          enum: ["twitter", "facebook", "linkedin", "threads", "ghost", "custom", null],
          default: "custom",
        },
        label: { type: ["string", "null"], minLength: 1 }, // User-facing name
        username: { type: ["string", "null"], minLength: 1 }, // Optional display handle
        display_name: { type: ["string", "null"] }, // Kept for backward compat
        connected_account_auth_id: { type: ["string", "null"], format: "uuid" }, // Link to OAuth
        profile_data: { type: "object" },
        last_synced_at: { type: ["string", "null"], format: "date-time" },
        last_analyzed_at: { type: ["string", "null"], format: "date-time" },
        sync_status: {
          type: "string",
          enum: ["pending", "syncing", "ready", "error"],
          default: "pending",
        },
        is_active: { type: "boolean", default: true },
        is_default: { type: "boolean", default: false },
        is_deletable: { type: "boolean", default: true },
        is_ghost_account: { type: "boolean", default: false },
        voice: { type: ["string", "null"] },
        topics_of_interest: { type: ["string", "null"] },
        last_content_type: { type: ["string", "null"] },
        last_posted_at: { type: ["string", "null"], format: "date-time" },
        content_rotation_enabled: { type: "boolean", default: true },
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
      auth: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccountAuth,
        join: {
          from: "connected_accounts.connected_account_auth_id",
          to: "connected_account_auth.id",
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
      rules: {
        relation: BaseModel.HasManyRelation,
        modelClass: Rule,
        join: {
          from: "connected_accounts.id",
          to: "rules.connected_account_id",
        },
      },
    };
  }

  /**
   * Prevent platform changes for connected accounts
   */
  async $beforeUpdate(opt, queryContext) {
    await super.$beforeUpdate(opt, queryContext);

    // If platform is changing and account is connected, block it
    if (this.platform && this.$old && this.$old.platform !== this.platform) {
      if (this.connected_account_auth_id || this.$old.connected_account_auth_id) {
        throw new Error(
          'Cannot change platform for connected accounts. ' +
          'Disconnect the account first to change platform.'
        );
      }
    }
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
        label: "My Drafts",
        username: null,
        display_name: "My Drafts",
        connected_account_auth_id: null, // No OAuth for ghost accounts
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
    const hoursSinceSync =
      (new Date() - new Date(this.last_synced_at)) / (1000 * 60 * 60);
    return hoursSinceSync >= hoursThreshold;
  }

  needsAnalysis(daysThreshold = 7) {
    if (!this.last_analyzed_at) return true;
    const daysSinceAnalysis =
      (new Date() - new Date(this.last_analyzed_at)) / (1000 * 60 * 60 * 24);
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
          qb.whereNull("last_synced_at").orWhere(
            "last_synced_at",
            "<",
            threshold.toISOString()
          );
        });
      },
    };
  }

  /**
   * Check if account is connected via OAuth
   */
  isConnected() {
    return !!this.connected_account_auth_id;
  }

  /**
   * Get decrypted access token
   * Tokens are stored encrypted in database and in auth table
   */
  getDecryptedAccessToken() {
    // Check if we have auth loaded
    if (this.auth) {
      if (!this.auth.access_token) return null;
      try {
        return decrypt(this.auth.access_token);
      } catch (error) {
        console.error("Failed to decrypt access token:", error);
        return null;
      }
    }
    return null;
  }

  /**
   * Get decrypted refresh token
   * Tokens are stored encrypted in database and in auth table
   */
  getDecryptedRefreshToken() {
    // Check if we have auth loaded
    if (this.auth) {
      if (!this.auth.refresh_token) return null;
      try {
        return decrypt(this.auth.refresh_token);
      } catch (error) {
        console.error("Failed to decrypt refresh token:", error);
        return null;
      }
    }
    return null;
  }

  /**
   * Check if access token is expired
   */
  isTokenExpired() {
    if (!this.auth || !this.auth.token_expires_at) return false;
    return new Date() >= new Date(this.auth.token_expires_at);
  }

  /**
   * Calculate completeness score (0-100)
   * Measures how personalized the account is for generating quality content
   */
  async getCompletenessScore() {
    // Check curated topics
    const userTopicIds = await UserTopicPreference.getUserTopicIds(this.id);
    const hasCuratedTopics = userTopicIds.length > 0;

    // Check custom topics
    const hasCustomTopics =
      this.topics_of_interest && this.topics_of_interest.trim().length > 0;
    const hasTopics = hasCuratedTopics || hasCustomTopics;

    // Check other data
    const sampleCount = this.sample_posts?.length || 0;
    const hasVoice = this.voice && this.voice.trim().length > 0;

    // Must have topics OR samples to work at all
    if (!hasTopics && sampleCount === 0) return 0;

    // Basic: has topics or samples (can generate)
    if (!hasVoice) return 33;

    // Good: has topics + voice (personalized)
    if (sampleCount < 3) return 66;

    // Excellent: has everything (fully personalized)
    return 100;
  }

  /**
   * Get recommendations for improving completeness
   */
  async getCompletionRecommendations() {
    const score = await this.getCompletenessScore();
    const recommendations = [];

    const userTopicIds = await UserTopicPreference.getUserTopicIds(this.id);
    const hasCuratedTopics = userTopicIds.length > 0;
    const hasCustomTopics =
      this.topics_of_interest && this.topics_of_interest.trim().length > 0;
    const hasTopics = hasCuratedTopics || hasCustomTopics;
    const sampleCount = this.sample_posts?.length || 0;
    const hasVoice = this.voice && this.voice.trim().length > 0;

    if (score === 0) {
      recommendations.push({
        priority: "critical",
        action: "select_topics",
        title: "Select topics of interest",
        description:
          "Choose topics you want to write about to start generating posts",
      });
    }

    if (score < 100) {
      if (!hasVoice) {
        recommendations.push({
          priority: "high",
          action: "add_voice",
          title: "Define your voice",
          description:
            "Add instructions about how you want to sound to personalize your posts",
        });
      }

      if (sampleCount === 0) {
        recommendations.push({
          priority: "medium",
          action: "add_samples",
          title: "Add sample posts",
          description: "Add 3+ example posts to help match your writing style",
        });
      } else if (sampleCount < 3) {
        recommendations.push({
          priority: "medium",
          action: "add_more_samples",
          title: `Add ${3 - sampleCount} more sample post${
            3 - sampleCount > 1 ? "s" : ""
          }`,
          description: "More samples improve style matching",
        });
      }
    }

    // Add sync recommendation for connected accounts
    if (this.platform !== "ghost") {
      if (!this.last_synced_at) {
        recommendations.push({
          priority: "high",
          action: "sync_network",
          title: "Sync your network",
          description: "Sync your posts to analyze your writing style",
        });
      } else if (this.needsSync(24)) {
        recommendations.push({
          priority: "low",
          action: "sync_network",
          title: "Refresh network data",
          description: "Your network data is outdated",
        });
      }
    }

    return recommendations;
  }

  /**
   * Get sync status information (includes completeness score)
   */
  async getSyncInfo() {
    const isGhost = this.platform === "ghost";
    const completeness_score = await this.getCompletenessScore();

    // Check what the user has for setup checklist
    const userTopicIds = await UserTopicPreference.getUserTopicIds(this.id);
    const hasCuratedTopics = userTopicIds.length > 0;
    const hasCustomTopics = this.topics_of_interest && this.topics_of_interest.trim().length > 0;
    const hasTopics = hasCuratedTopics || hasCustomTopics;
    const hasVoice = this.voice && this.voice.trim().length > 0;
    const samplePostsCount = this.sample_posts?.length || 0;
    const hasSamplePosts = samplePostsCount >= 3;

    // Count topics: curated topics + 1 if custom topics exist
    const topicsCount = userTopicIds.length + (hasCustomTopics ? 1 : 0);

    // Count rules
    const rulesCount = this.rules?.length || 0;

    return {
      is_ghost: isGhost,
      sync_status: isGhost ? "ready" : this.sync_status,
      last_synced_at: isGhost ? null : this.last_synced_at,
      last_analyzed_at: isGhost ? null : this.last_analyzed_at,
      needs_sync: isGhost ? false : this.needsSync(24),
      needs_analysis: isGhost ? false : this.needsAnalysis(7),
      completeness_score,
      // Setup checklist - what the user has configured
      has_topics: hasTopics,
      has_voice: hasVoice,
      has_sample_posts: hasSamplePosts,
      // Detailed counts
      topics_count: topicsCount,
      sample_posts_count: samplePostsCount,
      rules_count: rulesCount,
    };
  }

  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string|null>} Valid access token
   */
  async getValidAccessToken() {
    // Check if connected
    if (!this.isConnected()) {
      console.warn(`[ConnectedAccount] Account ${this.id} not connected`);
      return null;
    }

    // Load auth if not already loaded
    if (!this.auth) {
      await this.$fetchGraph('auth');
    }

    if (!this.auth) {
      console.warn(`[ConnectedAccount] No auth found for account ${this.id}`);
      return null;
    }

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

    console.log(
      `[ConnectedAccount] Access token expired for account ${this.id}, attempting refresh...`
    );

    // Check if we have a refresh token
    const refreshToken = this.getDecryptedRefreshToken();
    if (!refreshToken) {
      console.warn(
        `[ConnectedAccount] No refresh token available for account ${this.id}`
      );
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
      const oauthServices = {
        twitter: twitterOAuth,
        facebook: facebookOAuth,
        linkedin: linkedinOAuth,
      };

      const oauthService = oauthServices[this.platform];
      if (!oauthService) {
        console.warn(
          `[ConnectedAccount] No OAuth service for platform ${this.platform}`
        );
        return null;
      }

      // Refresh the token
      const tokenData = await oauthService.refreshAccessToken(refreshToken);

      // Update the token in the auth table
      await ConnectedAccountAuth.query()
        .findById(this.connected_account_auth_id)
        .patch({
          access_token: encrypt(tokenData.access_token),
          refresh_token: tokenData.refresh_token
            ? encrypt(tokenData.refresh_token)
            : this.auth.refresh_token,
          token_expires_at: oauthService.calculateExpiresAt(tokenData.expires_in),
          updated_at: new Date().toISOString(),
        });

      // Update local instance
      this.auth.access_token = encrypt(tokenData.access_token);
      if (tokenData.refresh_token) {
        this.auth.refresh_token = encrypt(tokenData.refresh_token);
      }
      this.auth.token_expires_at = oauthService.calculateExpiresAt(tokenData.expires_in);

      // Update metadata
      await this.$query().patch({
        metadata: {
          ...this.metadata,
          last_token_refresh: new Date().toISOString(),
        },
      });

      console.log(
        `[ConnectedAccount] Token refreshed successfully for account ${this.id}`
      );

      return tokenData.access_token;
    } catch (error) {
      console.error(
        `[ConnectedAccount] Failed to refresh token for account ${this.id}:`,
        error.message
      );

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

  // Ghost Account Methods
  static async getGhostTwitterAccount() {
    return this.query()
      .where("platform", "twitter")
      .where("is_ghost_account", true)
      .where("is_active", true)
      .first();
  }

  // Content Rotation Methods
  async getNextRecommendedContentType() {
    const { getNextContentType } = await import("#src/config/content-types.js");
    return getNextContentType(this.last_content_type);
  }

  async updateRotationState(contentType) {
    return this.$query().patchAndFetch({
      last_content_type: contentType,
      last_posted_at: new Date().toISOString(),
    });
  }

  async resetRotation() {
    return this.$query().patchAndFetch({
      last_content_type: null,
      last_posted_at: null,
    });
  }
}

export default ConnectedAccount;
