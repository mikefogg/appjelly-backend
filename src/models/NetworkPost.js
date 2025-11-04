import BaseModel from "#src/models/BaseModel.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";
import NetworkProfile from "#src/models/NetworkProfile.js";
import CuratedTopic from "#src/models/CuratedTopic.js";

class NetworkPost extends BaseModel {
  static get tableName() {
    return "network_posts";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["platform", "post_id", "content", "posted_at"],
      properties: {
        ...super.jsonSchema.properties,
        connected_account_id: { type: ["string", "null"], format: "uuid" },
        network_profile_id: { type: ["string", "null"], format: "uuid" },
        curated_topic_id: { type: ["string", "null"], format: "uuid" },
        platform: { type: "string", enum: ["twitter", "threads", "linkedin"] },
        platform_user_id: { type: ["string", "null"] },
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

  // JSONB columns handle arrays automatically - no conversion needed

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
      curated_topic: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: CuratedTopic,
        join: {
          from: "network_posts.curated_topic_id",
          to: "curated_topics.id",
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
      .whereRaw("topics @> ?::jsonb", [JSON.stringify([topic])])
      .orderBy("posted_at", "desc");
  }

  // Calculate trending topics from recent posts
  // Weighs by both frequency (how many posts mention it) and total engagement
  static async getTrendingTopics(connectedAccountId, hours = 48, limit = 10) {
    const threshold = new Date();
    threshold.setHours(threshold.getHours() - hours);

    // Use jsonb_array_elements_text for JSONB arrays
    // Weight: mention_count × total_engagement for true "hotness"
    const result = await this.query()
      .where("connected_account_id", connectedAccountId)
      .where("posted_at", ">=", threshold.toISOString())
      .whereNotNull("topics")
      .whereRaw("jsonb_array_length(topics) > 0") // Filter out empty arrays
      .select(
        this.knex().raw(`
          jsonb_array_elements_text(topics) as topic,
          COUNT(*) as mention_count,
          COALESCE(SUM(engagement_score), 0) as total_engagement,
          MAX(posted_at) as last_mentioned
        `)
      )
      .groupBy("topic")
      .orderByRaw("COUNT(*) * COALESCE(SUM(engagement_score), 1) DESC") // Frequency × Engagement
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
