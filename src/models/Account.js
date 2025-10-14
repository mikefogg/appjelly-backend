import BaseModel from "#src/models/BaseModel.js";
import App from "#src/models/App.js";
import Input from "#src/models/Input.js";
import Artifact from "#src/models/Artifact.js";
import Subscription from "#src/models/Subscription.js";

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
}

export default Account;
