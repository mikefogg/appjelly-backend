import BaseModel from "#src/models/BaseModel.js";
import Account from "#src/models/Account.js";

class Subscription extends BaseModel {
  static get tableName() {
    return "subscriptions";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["account_id", "rc_user_id"],
      properties: {
        ...super.jsonSchema.properties,
        account_id: { type: "string", format: "uuid" },
        rc_user_id: { type: "string", minLength: 1 },
        rc_entitlement: { type: "string" },
        rc_product_id: { type: "string" },
        rc_period_type: { type: "string", enum: ["normal", "trial", "intro"] },
        rc_renewal_status: { type: "string" },
        rc_platform: { type: "string", enum: ["ios", "android", "web", "amazon", "unknown"] },
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