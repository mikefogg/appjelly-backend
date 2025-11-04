import BaseModel from "#src/models/BaseModel.js";
import UserTopicPreference from "#src/models/UserTopicPreference.js";
import TrendingTopic from "#src/models/TrendingTopic.js";
import NetworkPost from "#src/models/NetworkPost.js";

class CuratedTopic extends BaseModel {
  static get tableName() {
    return "curated_topics";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["slug", "name"],
      properties: {
        ...super.jsonSchema.properties,
        slug: { type: "string", minLength: 1, maxLength: 100 },
        name: { type: "string", minLength: 1, maxLength: 255 },
        description: { type: ["string", "null"] },
        twitter_list_id: { type: ["string", "null"], maxLength: 255 },
        topic_type: {
          type: "string",
          enum: ["realtime", "evergreen", "hybrid"],
          default: "realtime"
        },
        is_active: { type: "boolean", default: true },
        last_synced_at: { type: ["string", "null"], format: "date-time" },
        last_digested_at: { type: ["string", "null"], format: "date-time" },
      },
    };
  }

  static get relationMappings() {
    return {
      user_preferences: {
        relation: BaseModel.HasManyRelation,
        modelClass: UserTopicPreference,
        join: {
          from: "curated_topics.id",
          to: "user_topic_preferences.curated_topic_id",
        },
      },
      trending_topics: {
        relation: BaseModel.HasManyRelation,
        modelClass: TrendingTopic,
        join: {
          from: "curated_topics.id",
          to: "trending_topics.curated_topic_id",
        },
      },
      network_posts: {
        relation: BaseModel.HasManyRelation,
        modelClass: NetworkPost,
        join: {
          from: "curated_topics.id",
          to: "network_posts.curated_topic_id",
        },
      },
    };
  }

  // Helper methods
  static async getActiveTopics() {
    return this.query()
      .where("is_active", true)
      .orderBy("name", "asc");
  }

  static async getTopicBySlug(slug) {
    return this.query()
      .where("slug", slug)
      .first();
  }

  static async getTopicsReadyForSync() {
    return this.query()
      .where("is_active", true)
      .whereNotNull("twitter_list_id")
      .whereIn("topic_type", ["realtime", "hybrid"])
      .orderBy("last_synced_at", "asc")
      .orderBy("name", "asc");
  }

  static async getEvergreenTopics() {
    return this.query()
      .where("is_active", true)
      .where("topic_type", "evergreen")
      .orderBy("name", "asc");
  }
}

export default CuratedTopic;
