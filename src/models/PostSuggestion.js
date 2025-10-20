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
          enum: ["pending", "used"],
          default: "pending"
        },
        dismissed_at: { type: ["string", "null"], format: "date-time" },
        topics: { type: ["array", "null"] },
        angle: { type: ["string", "null"], enum: [null, "hot_take", "roast", "hype", "story", "teach", "question"] },
        length: { type: ["string", "null"], enum: [null, "short", "medium", "long"] },
        character_count: { type: ["integer", "null"], minimum: 0 },
        metadata: { type: "object" },
        expires_at: { type: ["string", "null"], format: "date-time" },
      },
    };
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
      dismissed_at: new Date().toISOString(),
    });
  }

  static get modifiers() {
    return {
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
