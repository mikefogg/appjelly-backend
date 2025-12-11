import BaseModel from "#src/models/BaseModel.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";

class VoiceProfile extends BaseModel {
  static get tableName() {
    return "voice_profiles";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["connected_account_id"],
      properties: {
        ...super.jsonSchema.properties,
        connected_account_id: { type: "string", format: "uuid" },
        version: { type: "integer", minimum: 1 },
        status: { type: "string", enum: ["generating", "active"] },

        voice_summary: { type: ["string", "null"] },
        sentence_patterns: { type: ["string", "null"] },
        vocabulary_notes: { type: ["string", "null"] },
        tone_markers: { type: ["string", "null"] },
        formatting_habits: { type: ["string", "null"] },
        hard_rules: { type: "array", items: { type: "string" } },

        examples: { type: "object" },

        confidence: { type: "number", minimum: 0, maximum: 1 },
        confidence_reasoning: { type: ["string", "null"] },

        input_hash: { type: ["string", "null"] },
      },
    };
  }

  static get jsonAttributes() {
    return ["hard_rules", "examples"];
  }

  static get relationMappings() {
    return {
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "voice_profiles.connected_account_id",
          to: "connected_accounts.id",
        },
      },
    };
  }

  /**
   * Get the current active voice profile for a connected account
   */
  static async getCurrentProfile(connectedAccountId) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .where("status", "active")
      .orderBy("version", "desc")
      .first();
  }

  /**
   * Get any profile currently being generated
   */
  static async getGeneratingProfile(connectedAccountId) {
    return this.query()
      .where("connected_account_id", connectedAccountId)
      .where("status", "generating")
      .first();
  }

  /**
   * Get the next version number for a connected account
   */
  static async getNextVersion(connectedAccountId) {
    const latest = await this.query()
      .where("connected_account_id", connectedAccountId)
      .orderBy("version", "desc")
      .first();

    return (latest?.version || 0) + 1;
  }

  /**
   * Create a new generating profile
   */
  static async createGenerating(connectedAccountId, inputHash) {
    const version = await this.getNextVersion(connectedAccountId);

    return this.query().insert({
      connected_account_id: connectedAccountId,
      version,
      status: "generating",
      input_hash: inputHash,
    });
  }

  /**
   * Mark this profile as active
   */
  async activate() {
    return this.$query().patch({ status: "active" });
  }

  /**
   * Convert to the format expected by AI.generatePost()
   */
  toPromptFormat() {
    return {
      voice_summary: this.voice_summary,
      sentence_patterns: this.sentence_patterns,
      vocabulary_notes: this.vocabulary_notes,
      tone_markers: this.tone_markers,
      formatting_habits: this.formatting_habits,
      hard_rules: this.hard_rules || [],
    };
  }
}

export default VoiceProfile;
