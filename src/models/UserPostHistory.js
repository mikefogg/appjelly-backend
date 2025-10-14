import BaseModel from "#src/models/BaseModel.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";
import Artifact from "#src/models/Artifact.js";

class UserPostHistory extends BaseModel {
  static get tableName() {
    return "user_post_history";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["connected_account_id", "platform", "content", "posted_at"],
      properties: {
        ...super.jsonSchema.properties,
        connected_account_id: { type: "string", format: "uuid" },
        artifact_id: { type: ["string", "null"], format: "uuid" },
        platform: { type: "string", enum: ["twitter", "threads", "linkedin"] },
        post_id: { type: ["string", "null"] },
        content: { type: "string", minLength: 1 },
        posted_at: { type: "string", format: "date-time" },
        reply_count: { type: ["integer", "null"], minimum: 0 },
        retweet_count: { type: ["integer", "null"], minimum: 0 },
        like_count: { type: ["integer", "null"], minimum: 0 },
        engagement_score: { type: ["number", "null"], minimum: 0 },
        character_count: { type: ["integer", "null"], minimum: 0 },
        has_emoji: { type: ["boolean", "null"] },
        has_hashtags: { type: ["boolean", "null"] },
        has_mentions: { type: ["boolean", "null"] },
        tone: { type: ["string", "null"] },
        metadata: { type: "object" },
      },
    };
  }

  static get relationMappings() {
    return {
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "user_post_history.connected_account_id",
          to: "connected_accounts.id",
        },
      },
      artifact: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Artifact,
        join: {
          from: "user_post_history.artifact_id",
          to: "artifacts.id",
        },
      },
    };
  }

  static async findByConnectedAccount(connectedAccountId, limit = 50) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .orderBy("posted_at", "desc")
      .limit(limit);
  }

  static async getRecentForStyleAnalysis(connectedAccountId, limit = 50) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .whereNotNull("content")
      .orderBy("posted_at", "desc")
      .limit(limit);
  }

  static get modifiers() {
    return {
      recent(builder, days = 30) {
        const threshold = new Date();
        threshold.setDate(threshold.getDate() - days);
        builder.where("posted_at", ">=", threshold.toISOString());
      },
      highEngagement(builder, threshold = 10) {
        builder.where("engagement_score", ">=", threshold);
      },
    };
  }
}

export default UserPostHistory;
