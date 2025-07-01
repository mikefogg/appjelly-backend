import BaseModel from "#src/models/BaseModel.js";
import Account from "#src/models/Account.js";
import App from "#src/models/App.js";
import Media from "#src/models/Media.js";

class Actor extends BaseModel {
  static get tableName() {
    return "actors";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["account_id", "app_id", "name", "type"],
      properties: {
        ...super.jsonSchema.properties,
        account_id: { type: "string", format: "uuid" },
        app_id: { type: "string", format: "uuid" },
        name: { type: "string", minLength: 1, maxLength: 100 },
        nickname: { type: ["string", "null"], maxLength: 100 },
        type: { type: "string", minLength: 1, maxLength: 50 },
        is_claimable: { type: "boolean", default: false },
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
          from: "actors.account_id",
          to: "accounts.id",
        },
      },
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "actors.app_id",
          to: "apps.id",
        },
      },
      media: {
        relation: BaseModel.HasManyRelation,
        modelClass: Media,
        join: {
          from: "actors.id",
          to: "media.owner_id",
        },
        filter: {
          owner_type: "actor",
        },
      },
    };
  }

  static async findByAccountAndApp(accountId, appId) {
    return this.query()
      .where("account_id", accountId)
      .where("app_id", appId)
      .withGraphFetched("[media]")
      .orderBy("created_at", "desc");
  }

  static async findAccessibleActors(accountId, appId) {
    const knex = this.knex();
    
    return this.query()
      .where((builder) => {
        builder
          // All our own actors (regardless of claimable status)
          .where("actors.account_id", accountId)
          // Only non-claimable actors from linked families (verified ownership)
          .orWhereExists((subquery) => {
            subquery
              .select("*")
              .from("account_links")
              .whereRaw("account_links.linked_account_id = actors.account_id")
              .where("account_links.account_id", accountId)
              .where("account_links.app_id", appId)
              .where("account_links.status", "accepted")
              .whereRaw("actors.is_claimable = false"); // Only verified ownership
          });
      })
      .where("actors.app_id", appId)
      .withGraphFetched("[account(publicProfile), media]")
      .orderBy("actors.created_at", "desc");
  }

  static get modifiers() {
    return {
      publicInfo(builder) {
        builder.select("id", "name", "type", "metadata", "created_at");
      },
      withMedia(builder) {
        builder.withGraphFetched("[media]");
      },
      byType(builder, type) {
        builder.where("type", type);
      },
    };
  }
}

export default Actor;