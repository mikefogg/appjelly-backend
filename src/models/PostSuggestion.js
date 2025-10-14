import BaseModel from "#src/models/BaseModel.js";
import Account from "#src/models/Account.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";
import App from "#src/models/App.js";
import NetworkPost from "#src/models/NetworkPost.js";

class PostSuggestion extends BaseModel {
  static get tableName() {
    return "post_suggestions";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["account_id", "connected_account_id", "app_id", "suggestion_type", "content"],
      properties: {
        ...super.jsonSchema.properties,
        account_id: { type: "string", format: "uuid" },
        connected_account_id: { type: "string", format: "uuid" },
        app_id: { type: "string", format: "uuid" },
        suggestion_type: { type: "string", enum: ["original_post", "reply", "thread"] },
        content: { type: "string", minLength: 1 },
        reasoning: { type: ["string", "null"] },
        source_post_id: { type: ["string", "null"], format: "uuid" },
        source_data: { type: "object" },
        status: {
          type: "string",
          enum: ["pending", "used", "dismissed", "expired"],
          default: "pending"
        },
        topics: { type: ["array", "null"], items: { type: "string" } },
        character_count: { type: ["integer", "null"], minimum: 0 },
        metadata: { type: "object" },
        expires_at: { type: ["string", "null"], format: "date-time" },
      },
    };
  }

  // Handle PostgreSQL array conversion
  $parseDatabaseJson(json) {
    json = super.$parseDatabaseJson(json);
    if (json.topics && typeof json.topics === 'string') {
      json.topics = json.topics.replace(/[{}]/g, '').split(',').filter(t => t);
    }
    return json;
  }

  $formatDatabaseJson(json) {
    json = super.$formatDatabaseJson(json);
    if (Array.isArray(json.topics)) {
      json.topics = `{${json.topics.join(',')}}`;
    }
    return json;
  }

  static get relationMappings() {
    return {
      account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Account,
        join: {
          from: "post_suggestions.account_id",
          to: "accounts.id",
        },
      },
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "post_suggestions.connected_account_id",
          to: "connected_accounts.id",
        },
      },
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "post_suggestions.app_id",
          to: "apps.id",
        },
      },
      source_post: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: NetworkPost,
        join: {
          from: "post_suggestions.source_post_id",
          to: "network_posts.id",
        },
      },
    };
  }

  static async findActive(connectedAccountId) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .where("status", "pending")
      .where("expires_at", ">", new Date().toISOString())
      .orderBy("created_at", "desc");
  }

  static async findByType(connectedAccountId, suggestionType) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .where("suggestion_type", suggestionType)
      .where("status", "pending")
      .where("expires_at", ">", new Date().toISOString())
      .orderBy("created_at", "desc");
  }

  async markAsUsed() {
    return this.$query().patchAndFetch({
      status: "used",
      metadata: {
        ...this.metadata,
        used_at: new Date().toISOString(),
      },
    });
  }

  async markAsDismissed() {
    return this.$query().patchAndFetch({
      status: "dismissed",
      metadata: {
        ...this.metadata,
        dismissed_at: new Date().toISOString(),
      },
    });
  }

  static async expireOld() {
    return this.query()
      .where("status", "pending")
      .where("expires_at", "<=", new Date().toISOString())
      .patch({ status: "expired" });
  }

  static get modifiers() {
    return {
      active(builder) {
        builder
          .where("status", "pending")
          .where("expires_at", ">", new Date().toISOString());
      },
      byType(builder, suggestionType) {
        builder.where("suggestion_type", suggestionType);
      },
      recent(builder) {
        builder.orderBy("created_at", "desc");
      },
      withSourcePost(builder) {
        builder.withGraphFetched("[source_post.network_profile]");
      },
    };
  }
}

export default PostSuggestion;
