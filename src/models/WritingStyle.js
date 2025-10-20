import BaseModel from "#src/models/BaseModel.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";

class WritingStyle extends BaseModel {
  static get tableName() {
    return "writing_styles";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["connected_account_id"],
      properties: {
        ...super.jsonSchema.properties,
        connected_account_id: { type: "string", format: "uuid" },
        tone: { type: ["string", "null"] },
        avg_length: { type: ["integer", "null"], minimum: 0 },
        emoji_frequency: { type: ["number", "null"], minimum: 0, maximum: 100 },
        hashtag_frequency: { type: ["number", "null"], minimum: 0, maximum: 100 },
        question_frequency: { type: ["number", "null"], minimum: 0, maximum: 100 },
        common_phrases: { type: ["array", "null"], items: { type: "string" } },
        common_topics: { type: ["array", "null"], items: { type: "string" } },
        posting_times: { type: ["array", "null"], items: { type: "integer" } },
        style_summary: { type: ["string", "null"] },
        sample_size: { type: ["integer", "null"], minimum: 0 },
        confidence_score: { type: ["number", "null"], minimum: 0, maximum: 100 },
        analyzed_at: { type: ["string", "null"], format: "date-time" },
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
          from: "writing_styles.connected_account_id",
          to: "connected_accounts.id",
        },
      },
    };
  }

  static async findByConnectedAccount(connectedAccountId) {
    return this.query().findOne({ connected_account_id: connectedAccountId });
  }

  hasLowConfidence(threshold = 50) {
    return !this.confidence_score || this.confidence_score < threshold;
  }

  needsUpdate(daysThreshold = 7) {
    if (!this.analyzed_at) return true;
    const daysSinceAnalysis = (new Date() - new Date(this.analyzed_at)) / (1000 * 60 * 60 * 24);
    return daysSinceAnalysis >= daysThreshold;
  }

  getStyleDescription() {
    if (this.style_summary) {
      return this.style_summary;
    }

    const parts = [];
    if (this.tone) parts.push(`${this.tone} tone`);
    if (this.avg_length) parts.push(`${this.avg_length} chars average`);
    if (this.emoji_frequency > 50) parts.push("emoji-heavy");
    if (this.hashtag_frequency > 30) parts.push("uses hashtags frequently");

    return parts.length > 0 ? parts.join(", ") : "Style being analyzed";
  }

  static get modifiers() {
    return {
      highConfidence(builder, threshold = 70) {
        builder.where("confidence_score", ">=", threshold);
      },
      needsUpdate(builder, daysThreshold = 7) {
        const threshold = new Date();
        threshold.setDate(threshold.getDate() - daysThreshold);
        builder.where((qb) => {
          qb.whereNull("analyzed_at").orWhere("analyzed_at", "<", threshold.toISOString());
        });
      },
    };
  }
}

export default WritingStyle;
