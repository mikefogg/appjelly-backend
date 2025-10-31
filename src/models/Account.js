import BaseModel from "#src/models/BaseModel.js";
import App from "#src/models/App.js";
import Input from "#src/models/Input.js";
import Artifact from "#src/models/Artifact.js";
import Subscription from "#src/models/Subscription.js";
import { fromZonedTime } from "date-fns-tz";

class Account extends BaseModel {
  static get tableName() {
    return "accounts";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["clerk_id", "app_id"],
      properties: {
        ...super.jsonSchema.properties,
        clerk_id: { type: "string", minLength: 1 },
        email: { type: ["string", "null"], format: "email" },
        app_id: { type: "string", format: "uuid" },
        name: { type: ["string", "null"], minLength: 1, maxLength: 100 },
        timezone: { type: ["string", "null"], minLength: 1, maxLength: 100 },
        generation_time: { type: "integer", minimum: 0, maximum: 23 },
        generation_time_utc: { type: ["integer", "null"], minimum: 0, maximum: 23 },
        notifications_enabled: { type: "boolean" },
        notification_prompt_shown: { type: "boolean" },
        metadata: { type: "object" },
      },
    };
  }

  static get relationMappings() {
    return {
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "accounts.app_id",
          to: "apps.id",
        },
      },
      inputs: {
        relation: BaseModel.HasManyRelation,
        modelClass: Input,
        join: {
          from: "accounts.id",
          to: "inputs.account_id",
        },
      },
      artifacts: {
        relation: BaseModel.HasManyRelation,
        modelClass: Artifact,
        join: {
          from: "accounts.id",
          to: "artifacts.account_id",
        },
      },
      subscriptions: {
        relation: BaseModel.HasManyRelation,
        modelClass: Subscription,
        join: {
          from: "accounts.id",
          to: "subscriptions.account_id",
        },
      },
    };
  }

  static async findByClerkId(clerkId, appId) {
    return this.query()
      .findOne({ clerk_id: clerkId, app_id: appId })
      .withGraphFetched("[app, subscriptions]");
  }

  static async findWithSubscriptionData(clerkId, appId) {
    return this.query()
      .findOne({ clerk_id: clerkId, app_id: appId })
      .withGraphFetched("[app, subscriptions(active)]")
      .modifiers({
        active: (builder) => {
          builder
            .where("rc_renewal_status", "active")
            .where("rc_expiration", ">", new Date().toISOString())
            .orderBy("rc_expiration", "desc");
        },
      });
  }

  static getBaseAccountQuery() {
    return this.query()
      .withGraphFetched("[app, subscriptions(activeSubscription)]")
      .modifiers({
        activeSubscription: (builder) => {
          builder
            .where("rc_renewal_status", "active")
            .orderBy("created_at", "desc")
            .first();
        },
      });
  }

  static get modifiers() {
    return {
      publicProfile(builder) {
        builder.select("id", "email", "name", "metadata", "created_at");
      },
    };
  }

  // Instance methods for subscription management
  getActiveSubscription() {
    // Use pre-loaded subscription data if available, otherwise query
    if (this.subscriptions && Array.isArray(this.subscriptions)) {
      return this.subscriptions.find(sub =>
        sub.rc_renewal_status === "active" &&
        new Date(sub.rc_expiration) > new Date()
      ) || null;
    }

    // Fallback to querying if subscriptions not loaded
    return this.constructor.query()
      .joinRelated("subscriptions")
      .where("account_id", this.id)
      .where("subscriptions.rc_renewal_status", "active")
      .where("subscriptions.rc_expiration", ">", new Date().toISOString())
      .orderBy("subscriptions.rc_expiration", "desc")
      .first();
  }

  hasActiveSubscription() {
    const subscription = this.getActiveSubscription();
    return !!subscription;
  }

  hasEntitlement(entitlementName) {
    const subscription = this.getActiveSubscription();
    return subscription?.rc_entitlement === entitlementName;
  }

  getSubscriptionInfo() {
    const subscription = this.getActiveSubscription();
    if (!subscription) {
      return {
        is_active: false,
        entitlement: null,
        expires_at: null,
        renewal_status: null,
      };
    }

    return {
      is_active: true,
      entitlement: subscription.rc_entitlement,
      expires_at: subscription.rc_expiration,
      renewal_status: subscription.rc_renewal_status,
      platform: subscription.rc_platform,
    };
  }

  /**
   * Calculate the UTC hour for a given local hour and timezone
   * @param {number} localHour - Hour in local timezone (0-23)
   * @param {string} timezone - IANA timezone (e.g., "America/New_York")
   * @returns {number} Hour in UTC (0-23)
   */
  static calculateGenerationTimeUTC(localHour, timezone) {
    if (!timezone || localHour === null || localHour === undefined) {
      return null;
    }

    try {
      // Create a date object for today at the specified hour
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const day = now.getDate();

      // Create date representing the local time in the timezone
      const localDate = new Date(year, month, day, localHour, 0, 0);

      // Convert from zoned time to UTC
      const utcDate = fromZonedTime(localDate, timezone);

      return utcDate.getUTCHours();
    } catch (error) {
      console.error(`Failed to calculate UTC time for timezone ${timezone}:`, error);
      return null;
    }
  }

  /**
   * Recalculate generation_time_utc based on generation_time and timezone
   */
  calculateGenerationTimeUTC() {
    return Account.calculateGenerationTimeUTC(this.generation_time, this.timezone);
  }

  /**
   * Hook to auto-calculate generation_time_utc before insert
   */
  async $beforeInsert(queryContext) {
    await super.$beforeInsert(queryContext);

    // Auto-calculate UTC time if we have both timezone and generation_time
    if (this.timezone && this.generation_time !== null && this.generation_time !== undefined) {
      this.generation_time_utc = this.calculateGenerationTimeUTC();
    }
  }

  /**
   * Hook to auto-calculate generation_time_utc before update
   */
  async $beforeUpdate(opt, queryContext) {
    await super.$beforeUpdate(opt, queryContext);

    // Auto-recalculate UTC time if timezone or generation_time changed
    if (this.timezone !== undefined || this.generation_time !== undefined) {
      // Need to fetch current values if not provided in update
      const currentTimezone = this.timezone !== undefined ? this.timezone : opt.old?.timezone;
      const currentGenerationTime = this.generation_time !== undefined ? this.generation_time : opt.old?.generation_time;

      if (currentTimezone && currentGenerationTime !== null && currentGenerationTime !== undefined) {
        this.generation_time_utc = Account.calculateGenerationTimeUTC(currentGenerationTime, currentTimezone);
      }
    }
  }
}

export default Account;
