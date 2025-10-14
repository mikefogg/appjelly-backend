import BaseModel from "#src/models/BaseModel.js";
import Account from "#src/models/Account.js";
import App from "#src/models/App.js";
import Artifact from "#src/models/Artifact.js";
import Media from "#src/models/Media.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";

class Input extends BaseModel {
  static get tableName() {
    return "inputs";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["account_id", "app_id"],
      properties: {
        ...super.jsonSchema.properties,
        account_id: { type: "string", format: "uuid" },
        app_id: { type: "string", format: "uuid" },
        connected_account_id: { type: ["string", "null"], format: "uuid" },
        prompt: { type: ["string", "null"] },
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
          from: "inputs.account_id",
          to: "accounts.id",
        },
      },
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "inputs.app_id",
          to: "apps.id",
        },
      },
      artifacts: {
        relation: BaseModel.HasManyRelation,
        modelClass: Artifact,
        join: {
          from: "inputs.id",
          to: "artifacts.input_id",
        },
      },
      media: {
        relation: BaseModel.HasManyRelation,
        modelClass: Media,
        join: {
          from: "inputs.id",
          to: "media.owner_id",
        },
        filter: {
          owner_type: "input",
        },
      },
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "inputs.connected_account_id",
          to: "connected_accounts.id",
        },
      },
    };
  }

  static async findByAccountAndApp(accountId, appId, pagination = {}) {
    const query = this.query()
      .where("account_id", accountId)
      .where("app_id", appId)
      .withGraphFetched("[artifacts(latest), media]")
      .modifiers({
        latest: (builder) => {
          builder.orderBy("created_at", "desc").first();
        },
      })
      .orderBy("created_at", "desc");

    return this.getBasePaginationQuery(query, pagination);
  }

  static get modifiers() {
    return {
      withArtifacts(builder) {
        builder.withGraphFetched("[artifacts]");
      },
      withMedia(builder) {
        builder.withGraphFetched("[media]");
      },
      recent(builder) {
        builder.orderBy("created_at", "desc");
      },
    };
  }
}

export default Input;
