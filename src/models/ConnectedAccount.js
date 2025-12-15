import BaseModel from "#src/models/BaseModel.js";
import Account from "#src/models/Account.js";
import App from "#src/models/App.js";
import { FREEMIUM_CONFIG } from "#src/config/freemium.js";
import { calculateVoiceMatchScore } from "#src/utils/voice-match.js";
import NetworkProfile from "#src/models/NetworkProfile.js";
import NetworkPost from "#src/models/NetworkPost.js";
import PostSuggestion from "#src/models/PostSuggestion.js";
import UserTopicPreference from "#src/models/UserTopicPreference.js";
import WritingStyle from "#src/models/WritingStyle.js";
import UserPostHistory from "#src/models/UserPostHistory.js";
import SamplePost from "#src/models/SamplePost.js";
import Rule from "#src/models/Rule.js";
import ConnectedAccountAuth from "#src/models/ConnectedAccountAuth.js";
import VoiceProfile from "#src/models/VoiceProfile.js";
import VoiceFeedback from "#src/models/VoiceFeedback.js";
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
        bio: { type: "object" }, // Structured Q&A: { what_you_do, audience, perspective, differentiator }
        last_content_type: { type: ["string", "null"] },
        last_posted_at: { type: ["string", "null"], format: "date-time" },
        content_preferences: {
          type: "object",
          properties: {
            default_length: { type: "string", enum: ["short", "medium", "long"] },
            line_breaks: { type: "string", enum: ["minimal", "moderate", "frequent"] },
            emojis: { type: "string", enum: ["none", "sparse", "moderate", "heavy"] },
            hashtags: { type: "string", enum: ["none", "minimal", "moderate"] },
            rotation_enabled: { type: "boolean" },
          },
        },
        generation_time: { type: ["integer", "null"], minimum: 0, maximum: 23 },
        generation_time_utc: { type: ["integer", "null"], minimum: 0, maximum: 23 },
        metadata: { type: "object" },
      },
    };
  }

  static get jsonAttributes() {
    return ["profile_data", "bio", "content_preferences", "metadata"];
  }

  /**
   * Platform-specific default content preferences
   */
  static getDefaultContentPreferences(platform) {
    const defaults = {
      twitter: { default_length: "short", line_breaks: "moderate", emojis: "sparse", hashtags: "none", rotation_enabled: true },
      linkedin: { default_length: "medium", line_breaks: "moderate", emojis: "none", hashtags: "none", rotation_enabled: true },
      threads: { default_length: "short", line_breaks: "moderate", emojis: "sparse", hashtags: "none", rotation_enabled: true },
      facebook: { default_length: "short", line_breaks: "moderate", emojis: "sparse", hashtags: "none", rotation_enabled: true },
      ghost: { default_length: "short", line_breaks: "moderate", emojis: "sparse", hashtags: "none", rotation_enabled: true },
      custom: { default_length: "short", line_breaks: "moderate", emojis: "sparse", hashtags: "none", rotation_enabled: true },
    };
    return defaults[platform] || defaults.custom;
  }

  /**
   * Get content preferences with defaults filled in
   */
  getContentPreferences() {
    const defaults = ConnectedAccount.getDefaultContentPreferences(this.platform);
    return {
      ...defaults,
      ...(this.content_preferences || {}),
    };
  }

  /**
   * Calculate generation_time_utc from generation_time using account's timezone
   * @param {number} localHour - Hour in local timezone (0-23)
   * @param {string} timezone - IANA timezone from parent account
   * @returns {number|null} Hour in UTC (0-23)
   */
  static calculateGenerationTimeUTC(localHour, timezone) {
    // Delegate to Account's implementation
    return Account.calculateGenerationTimeUTC(localHour, timezone);
  }

  /**
   * Get the effective generation time (connection override or account default)
   * @param {Object} account - Parent account with generation_time and timezone
   * @returns {Object} { generation_time, generation_time_utc, is_override }
   */
  getEffectiveGenerationTime(account) {
    if (this.generation_time !== null && this.generation_time !== undefined) {
      return {
        generation_time: this.generation_time,
        generation_time_utc: this.generation_time_utc,
        is_override: true,
      };
    }
    return {
      generation_time: account?.generation_time,
      generation_time_utc: account?.generation_time_utc,
      is_override: false,
    };
  }

  /**
   * Get the next scheduled batch generation time as an ISO string
   * Uses connection's override if set, otherwise falls back to account
   * @param {Object} account - Parent account with generation_time_utc
   * @returns {string|null} ISO timestamp of next batch, or null if not configured
   */
  getNextBatchAt(account) {
    const { generation_time_utc } = this.getEffectiveGenerationTime(account);

    if (generation_time_utc === null || generation_time_utc === undefined) {
      return null;
    }

    const now = new Date();
    const currentUTCHour = now.getUTCHours();

    const nextBatch = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      generation_time_utc,
      0,
      0,
      0
    ));

    if (currentUTCHour >= generation_time_utc) {
      nextBatch.setUTCDate(nextBatch.getUTCDate() + 1);
    }

    return nextBatch.toISOString();
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
   * Fetch connections with ALL data needed for serialization.
   * Works for both list and detail views - same data shape.
   *
   * @param {string[]} connectionIds - Array of connection IDs to fetch
   * @param {string} accountId - Account ID for authorization
   * @param {string} appId - App ID for authorization
   * @returns {Object} Map of { [connectionId]: connectionWithAllData }
   */
  static async findWithDetails(connectionIds, accountId, appId) {
    if (!connectionIds || connectionIds.length === 0) return {};

    // Query 1: Get connections with counts via subqueries
    const connections = await this.query()
      .select(
        "connected_accounts.*",
        this.relatedQuery("sample_posts").count().as("sample_posts_count"),
        this.relatedQuery("rules").where("is_active", true).count().as("rules_count")
      )
      .whereIn("id", connectionIds)
      .where("account_id", accountId)
      .where("app_id", appId)
      .withGraphFetched("[sample_posts, rules]");

    if (connections.length === 0) return {};

    const foundIds = connections.map(c => c.id);

    // Query 2: Batch fetch all related data in parallel
    const [topicCounts, voiceProfiles, generatingProfiles, feedbackCounts, pendingFeedback] = await Promise.all([
      // Curated topic counts
      UserTopicPreference.query()
        .select("connected_account_id")
        .count("* as count")
        .whereIn("connected_account_id", foundIds)
        .groupBy("connected_account_id"),
      // Current voice profiles
      VoiceProfile.query()
        .whereIn("connected_account_id", foundIds)
        .where("status", "active")
        .orderBy("version", "desc"),
      // Generating voice profiles
      VoiceProfile.query()
        .whereIn("connected_account_id", foundIds)
        .where("status", "generating"),
      // Feedback counts (all statuses)
      VoiceFeedback.query()
        .select("connected_account_id")
        .count("* as count")
        .whereIn("connected_account_id", foundIds)
        .groupBy("connected_account_id"),
      // Pending/processing feedback (means we're effectively generating)
      VoiceFeedback.query()
        .select("connected_account_id")
        .whereIn("connected_account_id", foundIds)
        .whereIn("status", ["pending", "processing"])
        .groupBy("connected_account_id"),
    ]);

    // Build lookup maps
    const topicCountMap = new Map(topicCounts.map(t => [t.connected_account_id, parseInt(t.count, 10)]));
    const feedbackCountMap = new Map(feedbackCounts.map(f => [f.connected_account_id, parseInt(f.count, 10)]));
    const generatingMap = new Map(generatingProfiles.map(p => [p.connected_account_id, true]));
    const pendingFeedbackMap = new Map(pendingFeedback.map(p => [p.connected_account_id, true]));

    // Voice profiles: get latest per connection
    const voiceProfileMap = new Map();
    for (const profile of voiceProfiles) {
      if (!voiceProfileMap.has(profile.connected_account_id)) {
        voiceProfileMap.set(profile.connected_account_id, profile);
      }
    }

    // Build result map
    const result = {};
    for (const conn of connections) {
      const samplePostsCount = parseInt(conn.sample_posts_count, 10) || 0;
      const rulesCount = parseInt(conn.rules_count, 10) || 0;
      const curatedTopicsCount = topicCountMap.get(conn.id) || 0;
      const feedbackCount = feedbackCountMap.get(conn.id) || 0;

      // Compute sync info
      const isGhost = conn.platform === "ghost";
      const hasCustomTopics = conn.topics_of_interest && conn.topics_of_interest.trim().length > 0;
      const hasCuratedTopics = curatedTopicsCount > 0;
      const hasTopics = hasCuratedTopics || hasCustomTopics;
      const hasVoice = conn.voice && conn.voice.trim().length > 0;
      const hasSamplePosts = samplePostsCount >= 3;
      const topicsCount = curatedTopicsCount + (hasCustomTopics ? 1 : 0);

      // Attach voice data
      conn.voiceProfile = voiceProfileMap.get(conn.id) || null;
      conn.voiceStats = {
        rulesCount,
        feedbackCount,
        topicsCount,
        isGenerating: generatingMap.has(conn.id) || pendingFeedbackMap.has(conn.id),
      };

      // Compute completeness score
      let completenessScore = 0;
      if (hasTopics || samplePostsCount > 0) {
        completenessScore = 33;
        if (hasVoice) {
          completenessScore = 66;
          if (hasSamplePosts) {
            completenessScore = 100;
          }
        }
      }

      conn.syncInfo = {
        is_ghost: isGhost,
        sync_status: isGhost ? "ready" : conn.sync_status,
        last_synced_at: isGhost ? null : conn.last_synced_at,
        last_analyzed_at: isGhost ? null : conn.last_analyzed_at,
        needs_sync: isGhost ? false : conn.needsSync(24),
        needs_analysis: isGhost ? false : conn.needsAnalysis(7),
        completeness_score: completenessScore,
        has_topics: hasTopics,
        has_voice: hasVoice,
        has_sample_posts: hasSamplePosts,
        topics_count: topicsCount,
        sample_posts_count: samplePostsCount,
        rules_count: rulesCount,
      };

      // Compute recommendations
      const recommendations = [];
      if (completenessScore === 0) {
        recommendations.push({
          priority: "critical",
          action: "select_topics",
          title: "Select topics of interest",
          description: "Choose topics you want to write about to start generating posts",
        });
      }
      if (completenessScore < 100) {
        if (!hasVoice) {
          recommendations.push({
            priority: "high",
            action: "add_voice",
            title: "Define your voice",
            description: "Add instructions about how you want to sound to personalize your posts",
          });
        }
        if (samplePostsCount < 3) {
          recommendations.push({
            priority: samplePostsCount === 0 ? "high" : "medium",
            action: "add_samples",
            title: samplePostsCount === 0 ? "Add sample posts" : `Add ${3 - samplePostsCount} more sample posts`,
            description: "Sample posts help us understand your writing style",
          });
        }
      }
      conn.recommendations = recommendations;

      result[conn.id] = conn;
    }

    return result;
  }

  /**
   * Convenience: Fetch all connections for an account
   */
  static async findAllWithDetails(accountId, appId) {
    const connectionIds = await this.query()
      .select("id")
      .where("account_id", accountId)
      .where("app_id", appId)
      .where("is_active", true)
      .orderBy("created_at", "desc")
      .then(rows => rows.map(r => r.id));

    return this.findWithDetails(connectionIds, accountId, appId);
  }

  /**
   * Convenience: Fetch single connection by ID
   */
  static async findOneWithDetails(connectionId, accountId, appId) {
    const result = await this.findWithDetails([connectionId], accountId, appId);
    return result[connectionId] || null;
  }

  /**
   * Compute sync info from pre-loaded data (no additional queries).
   * Use this after fetching with findWithCountsForList().
   */
  computeSyncInfo() {
    const isGhost = this.platform === "ghost";

    // These come from findWithCountsForList()
    const samplePostsCount = parseInt(this.sample_posts_count, 10) || 0;
    const rulesCount = parseInt(this.rules_count, 10) || 0;
    const curatedTopicsCount = this.curated_topics_count || 0;

    // Check what the user has
    const hasCustomTopics = this.topics_of_interest && this.topics_of_interest.trim().length > 0;
    const hasCuratedTopics = curatedTopicsCount > 0;
    const hasTopics = hasCuratedTopics || hasCustomTopics;
    const hasVoice = this.voice && this.voice.trim().length > 0;
    const hasSamplePosts = samplePostsCount >= 3;

    // Topic count: curated + 1 if custom exists
    const topicsCount = curatedTopicsCount + (hasCustomTopics ? 1 : 0);

    // Compute completeness score
    let completenessScore = 0;
    if (hasTopics || samplePostsCount > 0) {
      completenessScore = 33;
      if (hasVoice) {
        completenessScore = 66;
        if (samplePostsCount >= 3) {
          completenessScore = 100;
        }
      }
    }

    // Compute needs_sync and needs_analysis
    const now = new Date();
    let needsSync = false;
    let needsAnalysis = false;

    if (!isGhost) {
      if (!this.last_synced_at) {
        needsSync = true;
      } else {
        const hoursSinceSync = (now - new Date(this.last_synced_at)) / (1000 * 60 * 60);
        needsSync = hoursSinceSync >= 24;
      }

      if (!this.last_analyzed_at) {
        needsAnalysis = true;
      } else {
        const daysSinceAnalysis = (now - new Date(this.last_analyzed_at)) / (1000 * 60 * 60 * 24);
        needsAnalysis = daysSinceAnalysis >= 7;
      }
    }

    return {
      is_ghost: isGhost,
      sync_status: isGhost ? "ready" : this.sync_status,
      last_synced_at: isGhost ? null : this.last_synced_at,
      last_analyzed_at: isGhost ? null : this.last_analyzed_at,
      needs_sync: needsSync,
      needs_analysis: needsAnalysis,
      completeness_score: completenessScore,
      has_topics: hasTopics,
      has_voice: hasVoice,
      has_sample_posts: hasSamplePosts,
      topics_count: topicsCount,
      sample_posts_count: samplePostsCount,
      rules_count: rulesCount,
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

  // Generation status methods
  async markVoiceUpdateStarted() {
    return this.$query().patch({
      voice_update_started_at: new Date().toISOString(),
    });
  }

  /**
   * Only mark voice update started if connection meets voice match threshold.
   * Returns true if threshold met and flag was set, false otherwise.
   * Use this before queueing voice profile jobs to avoid setting flags unnecessarily.
   */
  async markVoiceUpdateStartedIfOverThreshold() {
    const meetsThreshold = await this.meetsVoiceThreshold();
    if (meetsThreshold) {
      await this.markVoiceUpdateStarted();
      return true;
    }
    return false;
  }

  /**
   * Queue voice profile regeneration if connection meets threshold.
   * Sets flag and queues job atomically. Returns true if job was queued.
   * @param {Object} options - Additional options for the job (e.g., force: true)
   */
  async queueVoiceProfileRegenIfOverThreshold(options = {}) {
    if (await this.meetsVoiceThreshold()) {
      await this.markVoiceUpdateStarted();
      const { ghostQueue, JOB_GENERATE_VOICE_PROFILE } = await import("#src/background/queues/index.js");
      await ghostQueue.add(JOB_GENERATE_VOICE_PROFILE, {
        connectedAccountId: this.id,
        ...options,
      });
      return true;
    }
    return false;
  }

  /**
   * Queue voice feedback processing if connection meets threshold.
   * Sets flag and queues job atomically. Returns true if job was queued.
   * @param {string} feedbackId - The ID of the VoiceFeedback record to process
   */
  async queueVoiceFeedbackProcessingIfOverThreshold(feedbackId) {
    if (await this.meetsVoiceThreshold()) {
      await this.markVoiceUpdateStarted();
      const { ghostQueue, JOB_PROCESS_VOICE_FEEDBACK } = await import("#src/background/queues/index.js");
      await ghostQueue.add(JOB_PROCESS_VOICE_FEEDBACK, {
        feedbackId,
      });
      return true;
    }
    return false;
  }

  async markVoiceUpdateCompleted() {
    return this.$query().patch({
      voice_update_started_at: null,
    });
  }

  async markSuggestionsUpdateStarted() {
    return this.$query().patch({
      suggestions_update_started_at: new Date().toISOString(),
    });
  }

  async markSuggestionsUpdateCompleted() {
    return this.$query().patch({
      suggestions_update_started_at: null,
    });
  }

  /**
   * Check if voice is currently generating (started within last 5 minutes)
   */
  isVoiceGenerating() {
    if (!this.voice_update_started_at) return false;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return new Date(this.voice_update_started_at) > fiveMinutesAgo;
  }

  /**
   * Check if suggestions are currently generating (started within last 5 minutes)
   */
  isSuggestionsGenerating() {
    if (!this.suggestions_update_started_at) return false;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return new Date(this.suggestions_update_started_at) > fiveMinutesAgo;
  }

  /**
   * Check if connection has enough context for AI generation
   * Requires either: bio (at least one field) OR 1+ sample posts
   */
  isReadyForGeneration() {
    // Check if bio has at least one filled field
    const hasBio = this.bio && Object.values(this.bio).some(v => v && v.trim());

    // Check if has sample posts (need to be loaded via withGraphFetched or sample_posts_count)
    const hasSamplePosts = (this.sample_posts?.length > 0) || (parseInt(this.sample_posts_count, 10) > 0);

    return hasBio || hasSamplePosts;
  }

  /**
   * Get reason why connection is not ready for generation
   */
  getNotReadyReason() {
    if (this.isReadyForGeneration()) return null;
    return "Please add a bio or sample posts to enable AI generation.";
  }

  // ==========================================
  // FREEMIUM & VOICE MATCH METHODS
  // ==========================================

  /**
   * Get the total topics count (curated + custom)
   * Custom topics count as 1 if present (since it's free-text)
   */
  getTopicsCount(curatedTopicsCount = 0) {
    const hasCustomTopics = this.topics_of_interest && this.topics_of_interest.trim().length > 0;
    return curatedTopicsCount + (hasCustomTopics ? 1 : 0);
  }

  /**
   * Calculate voice match score (0-100)
   * Fetches all required counts internally - just call with the connection ID
   *
   * Scoring:
   * - Samples: 5% each, max 50%
   * - Feedback: 5% each, max 50%
   * - Rules: 2% each, max 10%
   * - Topics: 5% each, max 15%
   * - Bio fields: 5% each, max 20%
   */
  async getVoiceMatchScore() {
    // Fetch all counts in parallel
    const [sampleCount, rulesCount, feedbackCount, curatedTopicsCount] = await Promise.all([
      SamplePost.query().where("connected_account_id", this.id).resultSize(),
      Rule.query().where("connected_account_id", this.id).where("is_active", true).resultSize(),
      VoiceFeedback.query().where("connected_account_id", this.id).resultSize(),
      UserTopicPreference.query().where("connected_account_id", this.id).resultSize(),
    ]);

    const topicsCount = this.getTopicsCount(curatedTopicsCount);
    const bio = this.bio || {};

    const score = calculateVoiceMatchScore({ sampleCount, feedbackCount, rulesCount, topicsCount, bio });

    console.log(`[getVoiceMatchScore] id=${this.id} samples=${sampleCount} rules=${rulesCount} topics=${topicsCount} feedback=${feedbackCount} => ${score}%`);

    return score;
  }

  /**
   * Check if voice match meets threshold for AI features
   * @param {number} threshold - Minimum score required (default from config)
   */
  async meetsVoiceThreshold(threshold = FREEMIUM_CONFIG.VOICE_MATCH_THRESHOLD) {
    const score = await this.getVoiceMatchScore();
    return score >= threshold;
  }

  /**
   * Check if connection has reached generation limit (free users only)
   * @param {Object} account - Account model with subscription info
   */
  hasReachedGenerationLimit(account) {
    if (account.hasActiveSubscription()) return false;
    return (this.generated_posts_count || 0) >= FREEMIUM_CONFIG.FREE_POSTS_PER_CONNECTION;
  }

  /**
   * Increment generated posts counter
   * Sets generation_limit_reached_at when limit is hit
   * @param {number} count - Number of posts to add (default 1)
   */
  async incrementGeneratedPosts(count = 1) {
    const newCount = (this.generated_posts_count || 0) + count;
    const limit = FREEMIUM_CONFIG.FREE_POSTS_PER_CONNECTION;

    await this.$query().patch({
      generated_posts_count: newCount,
      ...(newCount >= limit ? { generation_limit_reached_at: new Date().toISOString() } : {})
    });

    // Update local instance
    this.generated_posts_count = newCount;
    if (newCount >= limit) {
      this.generation_limit_reached_at = new Date().toISOString();
    }

    return newCount;
  }
}

export default ConnectedAccount;
