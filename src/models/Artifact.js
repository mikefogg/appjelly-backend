import BaseModel from "#src/models/BaseModel.js";
import Input from "#src/models/Input.js";
import Account from "#src/models/Account.js";
import App from "#src/models/App.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";

class Artifact extends BaseModel {
  static get tableName() {
    return "artifacts";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["account_id", "app_id", "artifact_type"],
      properties: {
        ...super.jsonSchema.properties,
        input_id: { type: ["string", "null"], format: "uuid" },
        account_id: { type: "string", format: "uuid" },
        app_id: { type: "string", format: "uuid" },
        connected_account_id: { type: ["string", "null"], format: "uuid" },
        artifact_type: { type: "string", minLength: 1 },
        status: {
          type: "string",
          enum: ["draft", "pending", "generating", "completed", "failed"],
          default: "pending"
        },
        title: { type: ["string", "null"] },
        content: { type: ["string", "null"] },
        metadata: { type: "object" },

        // AI generation tracking
        total_tokens: { type: ["integer", "null"], minimum: 0 },
        prompt_tokens: { type: ["integer", "null"], minimum: 0 },
        completion_tokens: { type: ["integer", "null"], minimum: 0 },
        cost_usd: { type: ["number", "null"], minimum: 0 },
        generation_time_seconds: { type: ["number", "null"], minimum: 0 },
        ai_model: { type: ["string", "null"] },
        ai_provider: { type: ["string", "null"] },
      },
    };
  }

  static get relationMappings() {
    return {
      input: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Input,
        join: {
          from: "artifacts.input_id",
          to: "inputs.id",
        },
      },
      account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Account,
        join: {
          from: "artifacts.account_id",
          to: "accounts.id",
        },
      },
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "artifacts.app_id",
          to: "apps.id",
        },
      },
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "artifacts.connected_account_id",
          to: "connected_accounts.id",
        },
      },
    };
  }

  static async findByAccountAndApp(accountId, appId, pagination = {}) {
    const query = this.query()
      .where("account_id", accountId)
      .where("app_id", appId)
      .withGraphFetched("[input]")
      .orderBy("created_at", "desc");

    return this.getBasePaginationQuery(query, pagination);
  }

  // Status management helpers
  async markAsGenerating(trx = null) {
    return this.$query(trx).patchAndFetch({
      status: "generating",
      metadata: {
        ...this.metadata,
        processing_started_at: new Date().toISOString(),
      },
    });
  }

  async markAsCompleted(trx = null) {
    return this.$query(trx).patchAndFetch({
      status: "completed",
      metadata: {
        ...this.metadata,
        completed_at: new Date().toISOString(),
      },
    });
  }

  async markAsFailed(error, trx = null) {
    return this.$query(trx).patchAndFetch({
      status: "failed",
      metadata: {
        ...this.metadata,
        error: error.message,
        failed_at: new Date().toISOString(),
      },
    });
  }

  // Query helpers for status filtering
  static byStatus(status) {
    return this.query().where("status", status);
  }

  static draft() {
    return this.byStatus("draft");
  }

  static pending() {
    return this.byStatus("pending");
  }

  static generating() {
    return this.byStatus("generating");
  }

  static completed() {
    return this.byStatus("completed");
  }

  static failed() {
    return this.byStatus("failed");
  }

  // Check if artifact is a user draft (no input_id)
  isDraft() {
    return !this.input_id && this.status === "draft";
  }

  // Check if artifact is AI-generated (has input_id)
  isGenerated() {
    return !!this.input_id;
  }

  static get modifiers() {
    return {
      withInput(builder) {
        builder.withGraphFetched("[input]");
      },
      byType(builder, artifactType) {
        builder.where("artifact_type", artifactType);
      },
      recent(builder) {
        builder.orderBy("created_at", "desc");
      },
    };
  }
}

export default Artifact;
