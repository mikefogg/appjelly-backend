import BaseModel from "#src/models/BaseModel.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";
import NetworkProfile from "#src/models/NetworkProfile.js";

class NetworkPost extends BaseModel {
  static get tableName() {
    return "network_posts";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["connected_account_id", "network_profile_id", "platform", "post_id", "content", "posted_at"],
      properties: {
        ...super.jsonSchema.properties,
        connected_account_id: { type: "string", format: "uuid" },
        network_profile_id: { type: "string", format: "uuid" },
        platform: { type: "string", enum: ["twitter", "threads", "linkedin"] },
        post_id: { type: "string", minLength: 1 },
        content: { type: "string", minLength: 1 },
        posted_at: { type: "string", format: "date-time" },
        reply_count: { type: "integer", minimum: 0, default: 0 },
        retweet_count: { type: "integer", minimum: 0, default: 0 },
        like_count: { type: "integer", minimum: 0, default: 0 },
        quote_count: { type: "integer", minimum: 0, default: 0 },
        engagement_score: { type: ["number", "null"], minimum: 0 },
        topics: { type: ["array", "null"], items: { type: "string" } },
        sentiment: { type: ["string", "null"], enum: ["positive", "negative", "neutral", null] },
        metadata: { type: "object" },
      },
    };
  }

  // Handle PostgreSQL array conversion
  $parseDatabaseJson(json) {
    json = super.$parseDatabaseJson(json);
    // PostgreSQL arrays come as strings, convert to JS arrays
    if (json.topics && typeof json.topics === 'string') {
      json.topics = json.topics.replace(/[{}]/g, '').split(',').filter(t => t);
    }
    return json;
  }

  $formatDatabaseJson(json) {
    json = super.$formatDatabaseJson(json);
    // Convert JS arrays to PostgreSQL array format
    if (Array.isArray(json.topics)) {
      json.topics = `{${json.topics.join(',')}}`;
    }
    return json;
  }

  static get relationMappings() {
    return {
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "network_posts.connected_account_id",
          to: "connected_accounts.id",
        },
      },
      network_profile: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: NetworkProfile,
        join: {
          from: "network_posts.network_profile_id",
          to: "network_profiles.id",
        },
      },
    };
  }

  static async findRecent(connectedAccountId, hours = 48, limit = 100) {
    const threshold = new Date();
    threshold.setHours(threshold.getHours() - hours);

    return this.query()
      .where("connected_account_id", connectedAccountId)
      .where("posted_at", ">=", threshold.toISOString())
      .orderBy("posted_at", "desc")
      .limit(limit);
  }

  static async findTopEngaging(connectedAccountId, limit = 20) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .whereNotNull("engagement_score")
      .orderBy("engagement_score", "desc")
      .limit(limit);
  }

  static async findByTopic(connectedAccountId, topic) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .whereRaw("? = ANY(topics)", [topic])
      .orderBy("posted_at", "desc");
  }

  // Calculate trending topics from recent posts
  static async getTrendingTopics(connectedAccountId, hours = 48, limit = 10) {
    const threshold = new Date();
    threshold.setHours(threshold.getHours() - hours);

    const result = await this.query()
      .where("connected_account_id", connectedAccountId)
      .where("posted_at", ">=", threshold.toISOString())
      .whereNotNull("topics")
      .select(this.knex().raw("unnest(topics) as topic, COUNT(*) as count"))
      .groupBy("topic")
      .orderBy("count", "desc")
      .limit(limit);

    return result;
  }

  static get modifiers() {
    return {
      recent(builder, hours = 48) {
        const threshold = new Date();
        threshold.setHours(threshold.getHours() - hours);
        builder.where("posted_at", ">=", threshold.toISOString());
      },
      highEngagement(builder, threshold = 10) {
        builder.where("engagement_score", ">=", threshold);
      },
      withProfile(builder) {
        builder.withGraphFetched("[network_profile]");
      },
    };
  }
}

export default NetworkPost;
