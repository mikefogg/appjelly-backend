import BaseModel from "#src/models/BaseModel.js";
import Account from "#src/models/Account.js";
import App from "#src/models/App.js";

class AccountLink extends BaseModel {
  static get tableName() {
    return "account_links";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["account_id", "linked_account_id", "app_id", "status", "created_by_id"],
      properties: {
        ...super.jsonSchema.properties,
        account_id: { type: "string", format: "uuid" },
        linked_account_id: { type: "string", format: "uuid" },
        app_id: { type: "string", format: "uuid" },
        status: { type: "string", enum: ["pending", "accepted", "revoked"] },
        created_by_id: { type: "string", format: "uuid" },
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
          from: "account_links.account_id",
          to: "accounts.id",
        },
      },
      linked_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Account,
        join: {
          from: "account_links.linked_account_id",
          to: "accounts.id",
        },
      },
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "account_links.app_id",
          to: "apps.id",
        },
      },
      created_by: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Account,
        join: {
          from: "account_links.created_by_id",
          to: "accounts.id",
        },
      },
    };
  }

  static async findTrustedLinks(accountId, appId) {
    return this.query()
      .where("account_id", accountId)
      .where("app_id", appId)
      .where("status", "accepted")
      .withGraphFetched("[linked_account, app]");
  }

  static async findPendingRequests(accountId, appId) {
    return this.query()
      .where("linked_account_id", accountId)
      .where("app_id", appId)
      .where("status", "pending")
      .withGraphFetched("[account, created_by]");
  }

  static get modifiers() {
    return {
      accepted(builder) {
        builder.where("status", "accepted");
      },
      pending(builder) {
        builder.where("status", "pending");
      },
      withLinkedAccount(builder) {
        builder.withGraphFetched("[linked_account(publicProfile)]");
      },
    };
  }
}

export default AccountLink;