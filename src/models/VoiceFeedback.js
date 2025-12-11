import BaseModel from "#src/models/BaseModel.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";

class VoiceFeedback extends BaseModel {
  static get tableName() {
    return "voice_feedback";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["connected_account_id", "feedback"],
      properties: {
        ...super.jsonSchema.properties,
        connected_account_id: { type: "string", format: "uuid" },
        feedback: { type: "string", minLength: 1 },
        reference_text: { type: ["string", "null"] },
        status: {
          type: "string",
          enum: ["pending", "processing", "processed", "failed"],
          default: "pending",
        },
        applied_to_version: { type: ["integer", "null"] },
        ai_reasoning: { type: ["string", "null"] },
        processed_at: { type: ["string", "null"], format: "date-time" },
      },
    };
  }

  static get relationMappings() {
    return {
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "voice_feedback.connected_account_id",
          to: "connected_accounts.id",
        },
      },
    };
  }

  /**
   * Get pending feedback for a connected account
   */
  static async getPending(connectedAccountId) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .where("status", "pending")
      .orderBy("created_at", "asc");
  }

  /**
   * Get any feedback currently being processed
   */
  static async getProcessing(connectedAccountId) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .where("status", "processing")
      .first();
  }

  /**
   * Get recent processed feedback for a connected account
   */
  static async getRecent(connectedAccountId, limit = 10) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .where("status", "processed")
      .orderBy("processed_at", "desc")
      .limit(limit);
  }

  /**
   * Get feedback count for a connected account (all statuses)
   */
  static async getCount(connectedAccountId) {
    const result = await this.query()
      .where("connected_account_id", connectedAccountId)
      .count("id as count")
      .first();
    return parseInt(result?.count || 0);
  }

  /**
   * Mark as processing
   */
  async markProcessing() {
    return this.$query().patch({ status: "processing" });
  }

  /**
   * Mark as processed with results
   */
  async markProcessed(appliedToVersion, aiReasoning) {
    return this.$query().patch({
      status: "processed",
      applied_to_version: appliedToVersion,
      ai_reasoning: aiReasoning,
      processed_at: new Date().toISOString(),
    });
  }

  /**
   * Mark as failed
   */
  async markFailed(reason) {
    return this.$query().patch({
      status: "failed",
      ai_reasoning: reason,
      processed_at: new Date().toISOString(),
    });
  }
}

export default VoiceFeedback;
