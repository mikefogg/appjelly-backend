import BaseModel from "#src/models/BaseModel.js";
import Account from "#src/models/Account.js";
import App from "#src/models/App.js";

class Subscription extends BaseModel {
  static get tableName() {
    return "subscriptions";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["rc_user_id"],
      properties: {
        ...super.jsonSchema.properties,
        account_id: { type: ["string", "null"], format: "uuid" },
        app_id: { type: ["string", "null"], format: "uuid" },
        rc_user_id: { type: "string", minLength: 1 },
        rc_entitlement: { type: "string" },
        rc_product_id: { type: "string" },
        rc_period_type: { type: "string", enum: ["normal", "trial", "intro"] },
        rc_renewal_status: { type: "string" },
        rc_platform: { type: "string", enum: ["ios", "android", "web", "amazon", "manual", "unknown"] },
        rc_expiration: { type: "string", format: "date-time" },
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
          from: "subscriptions.account_id",
          to: "accounts.id",
        },
      },
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "subscriptions.app_id",
          to: "apps.id",
        },
      },
    };
  }

  static async findActiveByAccount(accountId) {
    return this.query()
      .where("account_id", accountId)
      .where("rc_renewal_status", "active")
      .where("rc_expiration", ">", new Date().toISOString())
      .orderBy("rc_expiration", "desc")
      .first();
  }

  /**
   * Grant manual subscription access to an account
   * @param {string} accountId - Account ID
   * @param {string} appId - App ID
   * @param {Date|string} expiresAt - Expiration date
   * @param {string} reason - Reason for granting (e.g., "development", "beta_tester")
   */
  static async grantManualAccess(accountId, appId, expiresAt, reason = "manual_grant") {
    const expiration = new Date(expiresAt).toISOString();

    // Check for existing manual subscription
    const existing = await this.query()
      .where("account_id", accountId)
      .where("app_id", appId)
      .where("rc_platform", "manual")
      .first();

    if (existing) {
      // Update existing
      return existing.$query().patchAndFetch({
        rc_renewal_status: "active",
        rc_expiration: expiration,
        metadata: {
          ...existing.metadata,
          reason,
          updated_at: new Date().toISOString(),
        },
      });
    }

    // Create new manual subscription
    return this.query().insert({
      account_id: accountId,
      app_id: appId,
      rc_user_id: `manual_${accountId}`,
      rc_entitlement: "ghost_pro",
      rc_product_id: "manual_grant",
      rc_period_type: "normal",
      rc_renewal_status: "active",
      rc_platform: "manual",
      rc_expiration: expiration,
      metadata: {
        manual: true,
        reason,
        granted_at: new Date().toISOString(),
      },
    });
  }

  /**
   * Revoke manual subscription access
   */
  static async revokeManualAccess(accountId, appId) {
    return this.query()
      .where("account_id", accountId)
      .where("app_id", appId)
      .where("rc_platform", "manual")
      .patch({
        rc_renewal_status: "revoked",
        metadata: this.raw("metadata || ?", { revoked_at: new Date().toISOString() }),
      });
  }

  static async findByRevenueCatUserId(rcUserId) {
    return this.query()
      .where("rc_user_id", rcUserId)
      .orderBy("created_at", "desc");
  }

  static async updateFromWebhook(rcUserId, webhookData) {
    const existingSubscription = await this.query()
      .where("rc_user_id", rcUserId)
      .where("rc_product_id", webhookData.product_id)
      .first();

    const subscriptionData = {
      rc_user_id: rcUserId,
      rc_entitlement: webhookData.entitlement,
      rc_product_id: webhookData.product_id,
      rc_period_type: webhookData.period_type,
      rc_renewal_status: webhookData.renewal_status,
      rc_platform: webhookData.platform,
      rc_expiration: webhookData.expiration_date,
      metadata: {
        ...webhookData,
        last_webhook_update: new Date().toISOString(),
      },
    };

    if (existingSubscription) {
      return existingSubscription.$query().patchAndFetch(subscriptionData);
    } else {
      if (!subscriptionData.account_id && webhookData.account_id) {
        subscriptionData.account_id = webhookData.account_id;
      }
      if (!subscriptionData.account_id) {
        throw new Error("account_id is required for new subscription");
      }
      return this.query().insert(subscriptionData);
    }
  }

  isActive() {
    return (
      this.rc_renewal_status === "active" &&
      this.rc_expiration &&
      new Date(this.rc_expiration) > new Date()
    );
  }

  isExpired() {
    return (
      this.rc_expiration &&
      new Date(this.rc_expiration) <= new Date()
    );
  }

  hasEntitlement(entitlementName) {
    return this.rc_entitlement === entitlementName && this.isActive();
  }

  static get modifiers() {
    return {
      active(builder) {
        builder
          .where("rc_renewal_status", "active")
          .where("rc_expiration", ">", new Date().toISOString());
      },
      expired(builder) {
        builder.where("rc_expiration", "<=", new Date().toISOString());
      },
      byPlatform(builder, platform) {
        builder.where("rc_platform", platform);
      },
      byEntitlement(builder, entitlement) {
        builder.where("rc_entitlement", entitlement);
      },
      recent(builder) {
        builder.orderBy("created_at", "desc");
      },
    };
  }
}

export default Subscription;