import BaseModel from "#src/models/BaseModel.js";
import CuratedTopic from "#src/models/CuratedTopic.js";

class TrendingTopic extends BaseModel {
  static get tableName() {
    return "trending_topics";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["curated_topic_id", "topic_name", "detected_at"],
      properties: {
        ...super.jsonSchema.properties,
        curated_topic_id: { type: "string", format: "uuid" },
        topic_name: { type: "string", minLength: 1, maxLength: 500 },
        context: { type: ["string", "null"] },
        mention_count: { type: "integer", minimum: 0, default: 0 },
        total_engagement: { type: "number", minimum: 0, default: 0 },
        sample_post_ids: { type: ["array", "null"] },
        detected_at: { type: "string", format: "date-time" },
        expires_at: { type: ["string", "null"], format: "date-time" },
        topic_type: {
          type: "string",
          enum: ["realtime", "evergreen"],
          default: "realtime"
        },
        rotation_group: { type: ["integer", "null"], minimum: 1, maximum: 7 },
        sort_order: { type: "integer", default: 0 },
      },
    };
  }

  static get relationMappings() {
    return {
      curated_topic: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: CuratedTopic,
        join: {
          from: "trending_topics.curated_topic_id",
          to: "curated_topics.id",
        },
      },
    };
  }

  // Helper methods
  static async getRecentForTopics(topicIds, hoursBack = 48) {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    return this.query()
      .whereIn("curated_topic_id", topicIds)
      .where("detected_at", ">", cutoffTime.toISOString())
      .where(function() {
        this.whereNull("expires_at")
          .orWhere("expires_at", ">", new Date().toISOString());
      })
      .orderBy("total_engagement", "desc")
      .orderBy("detected_at", "desc");
  }

  static async getRecentForTopic(curatedTopicId, hoursBack = 48) {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    return this.query()
      .where("curated_topic_id", curatedTopicId)
      .where("detected_at", ">", cutoffTime.toISOString())
      .where(function() {
        this.whereNull("expires_at")
          .orWhere("expires_at", ">", new Date().toISOString());
      })
      .orderBy("total_engagement", "desc")
      .orderBy("detected_at", "desc");
  }

  static async cleanupExpired() {
    const now = new Date().toISOString();

    const deleted = await this.query()
      .whereNotNull("expires_at")
      .where("expires_at", "<", now)
      .delete();

    console.log(`[TrendingTopic] Cleaned up ${deleted} expired trending topics`);
    return deleted;
  }

  static async getTopTopicsForGeneration(topicIds, limit = 20) {
    return this.query()
      .whereIn("curated_topic_id", topicIds)
      .where(function() {
        this.whereNull("expires_at")
          .orWhere("expires_at", ">", new Date().toISOString());
      })
      .orderBy("total_engagement", "desc")
      .orderBy("detected_at", "desc")
      .limit(limit);
  }

  // Get evergreen topics for today's rotation (based on day of week)
  static async getEvergreenForToday(topicIds) {
    const dayOfWeek = new Date().getDay() || 7; // 1-7 (Sunday = 7)

    return this.query()
      .whereIn("curated_topic_id", topicIds)
      .where("topic_type", "evergreen")
      .where("rotation_group", dayOfWeek)
      .orderBy("sort_order", "asc")
      .orderBy("topic_name", "asc");
  }

  // Get evergreen topics for a specific curated topic
  static async getEvergreenForTopic(curatedTopicId, dayOfWeek = null) {
    const day = dayOfWeek || new Date().getDay() || 7;

    return this.query()
      .where("curated_topic_id", curatedTopicId)
      .where("topic_type", "evergreen")
      .where("rotation_group", day)
      .orderBy("sort_order", "asc")
      .orderBy("topic_name", "asc");
  }

  // Get mixed trending topics (realtime + evergreen for today)
  static async getMixedTrendingForTopics(topicIds, realtimeLimit = 5, evergreenLimit = 5) {
    const dayOfWeek = new Date().getDay() || 7;
    const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Get realtime topics
    const realtime = await this.query()
      .whereIn("curated_topic_id", topicIds)
      .where("topic_type", "realtime")
      .where("detected_at", ">", cutoffTime.toISOString())
      .where(function() {
        this.whereNull("expires_at")
          .orWhere("expires_at", ">", new Date().toISOString());
      })
      .orderBy("total_engagement", "desc")
      .limit(realtimeLimit)
      .withGraphFetched("curated_topic");

    // Get evergreen topics for today
    const evergreen = await this.query()
      .whereIn("curated_topic_id", topicIds)
      .where("topic_type", "evergreen")
      .where("rotation_group", dayOfWeek)
      .orderBy("sort_order", "asc")
      .limit(evergreenLimit)
      .withGraphFetched("curated_topic");

    return { realtime, evergreen };
  }
}

export default TrendingTopic;
