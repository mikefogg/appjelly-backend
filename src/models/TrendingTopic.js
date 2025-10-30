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
}

export default TrendingTopic;
