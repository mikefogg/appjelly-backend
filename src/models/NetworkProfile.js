import BaseModel from "#src/models/BaseModel.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";
import NetworkPost from "#src/models/NetworkPost.js";

class NetworkProfile extends BaseModel {
  static get tableName() {
    return "network_profiles";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["connected_account_id", "platform", "platform_user_id", "username"],
      properties: {
        ...super.jsonSchema.properties,
        connected_account_id: { type: "string", format: "uuid" },
        platform: { type: "string", enum: ["twitter", "threads", "linkedin"] },
        platform_user_id: { type: "string", minLength: 1 },
        username: { type: "string", minLength: 1 },
        display_name: { type: ["string", "null"] },
        bio: { type: ["string", "null"] },
        follower_count: { type: ["integer", "null"], minimum: 0 },
        following_count: { type: ["integer", "null"], minimum: 0 },
        is_verified: { type: "boolean", default: false },
        profile_image_url: { type: ["string", "null"] },
        profile_data: { type: "object" },
        engagement_score: { type: ["number", "null"], minimum: 0 },
        relevance_score: { type: ["number", "null"], minimum: 0 },
        last_synced_at: { type: ["string", "null"], format: "date-time" },
      },
    };
  }

  static get relationMappings() {
    return {
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "network_profiles.connected_account_id",
          to: "connected_accounts.id",
        },
      },
      posts: {
        relation: BaseModel.HasManyRelation,
        modelClass: NetworkPost,
        join: {
          from: "network_profiles.id",
          to: "network_posts.network_profile_id",
        },
      },
    };
  }

  static async findByConnectedAccount(connectedAccountId) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .orderBy("engagement_score", "desc");
  }

  static async findTopEngaged(connectedAccountId, limit = 50) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .whereNotNull("engagement_score")
      .orderBy("engagement_score", "desc")
      .limit(limit);
  }

  static get modifiers() {
    return {
      verified(builder) {
        builder.where("is_verified", true);
      },
      highEngagement(builder, threshold = 5.0) {
        builder.where("engagement_score", ">=", threshold);
      },
      recent(builder) {
        builder.orderBy("last_synced_at", "desc");
      },
    };
  }
}

export default NetworkProfile;
