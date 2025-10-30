import BaseModel from "#src/models/BaseModel.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";
import CuratedTopic from "#src/models/CuratedTopic.js";

class UserTopicPreference extends BaseModel {
  static get tableName() {
    return "user_topic_preferences";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["connected_account_id", "curated_topic_id"],
      properties: {
        ...super.jsonSchema.properties,
        connected_account_id: { type: "string", format: "uuid" },
        curated_topic_id: { type: "string", format: "uuid" },
      },
    };
  }

  static get relationMappings() {
    return {
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "user_topic_preferences.connected_account_id",
          to: "connected_accounts.id",
        },
      },
      curated_topic: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: CuratedTopic,
        join: {
          from: "user_topic_preferences.curated_topic_id",
          to: "curated_topics.id",
        },
      },
    };
  }

  // Helper methods
  static async getUserTopics(connectedAccountId) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .withGraphFetched("curated_topic");
  }

  static async getUserTopicIds(connectedAccountId) {
    const preferences = await this.query()
      .where("connected_account_id", connectedAccountId)
      .select("curated_topic_id");

    return preferences.map(p => p.curated_topic_id);
  }

  static async setUserTopics(connectedAccountId, topicIds) {
    // Delete existing preferences
    await this.query()
      .where("connected_account_id", connectedAccountId)
      .delete();

    // Insert new preferences
    if (topicIds && topicIds.length > 0) {
      const preferences = topicIds.map(topicId => ({
        connected_account_id: connectedAccountId,
        curated_topic_id: topicId,
      }));

      return this.query().insert(preferences);
    }

    return [];
  }

  static async hasUserSelectedTopics(connectedAccountId) {
    const count = await this.query()
      .where("connected_account_id", connectedAccountId)
      .resultSize();

    return count > 0;
  }
}

export default UserTopicPreference;
