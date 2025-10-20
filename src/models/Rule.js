import BaseModel from "#src/models/BaseModel.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";
import PostSuggestion from "#src/models/PostSuggestion.js";

class Rule extends BaseModel {
  static get tableName() {
    return "rules";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["connected_account_id", "rule_type", "content"],
      properties: {
        ...super.jsonSchema.properties,
        connected_account_id: { type: "string", format: "uuid" },
        rule_type: { type: "string", enum: ["never", "always", "prefer", "tone"] },
        content: { type: "string", minLength: 1 },
        feedback_on_suggestion_id: { type: ["string", "null"], format: "uuid" },
        priority: { type: "integer", minimum: 1, maximum: 10, default: 5 },
        is_active: { type: "boolean", default: true },
      },
    };
  }

  static get relationMappings() {
    return {
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "rules.connected_account_id",
          to: "connected_accounts.id",
        },
      },
      suggestion: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: PostSuggestion,
        join: {
          from: "rules.feedback_on_suggestion_id",
          to: "post_suggestions.id",
        },
      },
    };
  }

  // Helper methods for querying
  static async getActiveRules(connectedAccountId) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .where("is_active", true)
      .orderBy("priority", "desc")
      .orderBy("created_at", "asc");
  }

  static async getGeneralRules(connectedAccountId, activeOnly = true) {
    const query = this.query()
      .where("connected_account_id", connectedAccountId)
      .whereNull("feedback_on_suggestion_id")
      .orderBy("priority", "desc")
      .orderBy("created_at", "asc");

    if (activeOnly) {
      query.where("is_active", true);
    }

    return query;
  }

  static async getFeedbackRules(connectedAccountId, suggestionId = null, activeOnly = true) {
    const query = this.query()
      .where("connected_account_id", connectedAccountId)
      .whereNotNull("feedback_on_suggestion_id");

    if (suggestionId) {
      query.where("feedback_on_suggestion_id", suggestionId);
    }

    if (activeOnly) {
      query.where("is_active", true);
    }

    return query
      .orderBy("priority", "desc")
      .orderBy("created_at", "desc");
  }
}

export default Rule;
