import BaseModel from "#src/models/BaseModel.js";
import App from "#src/models/App.js";
import Account from "#src/models/Account.js";

class OnboardingSample extends BaseModel {
  static get tableName() {
    return "onboarding_samples";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["app_id", "platform", "stats", "input"],
      properties: {
        ...super.jsonSchema.properties,
        app_id: { type: "string", format: "uuid" },
        account_id: { type: ["string", "null"], format: "uuid" },
        platform: { type: "string", minLength: 1 },
        stats: { type: "object" },
        input: { type: "string", minLength: 1 },
        version: { type: "integer", minimum: 1, default: 1 },
        status: {
          type: "string",
          enum: ["pending", "generating", "completed", "failed"],
          default: "pending",
        },
        content: { type: ["string", "null"] },
        previous_sample_id: { type: ["string", "null"], format: "uuid" },
        feedback_input: { type: ["string", "null"] },
        metadata: { type: "object" },
      },
    };
  }

  static get relationMappings() {
    return {
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "onboarding_samples.app_id",
          to: "apps.id",
        },
      },
      account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Account,
        join: {
          from: "onboarding_samples.account_id",
          to: "accounts.id",
        },
      },
      previous_sample: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: OnboardingSample,
        join: {
          from: "onboarding_samples.previous_sample_id",
          to: "onboarding_samples.id",
        },
      },
    };
  }

  /**
   * Create a new onboarding sample
   */
  static async create({ appId, accountId, platform, stats, input, previousSampleId = null, feedbackInput = null }) {
    let version = 1;

    // If there's a previous sample, increment version
    if (previousSampleId) {
      const previousSample = await this.query().findById(previousSampleId);
      if (previousSample) {
        version = previousSample.version + 1;
      }
    }

    return this.query().insert({
      app_id: appId,
      account_id: accountId,
      platform,
      stats,
      input,
      version,
      status: "pending",
      previous_sample_id: previousSampleId,
      feedback_input: feedbackInput,
      metadata: {},
    });
  }

  /**
   * Mark sample as generating
   */
  async markGenerating() {
    return this.$query().patchAndFetch({
      status: "generating",
      metadata: {
        ...this.metadata,
        processing_started_at: new Date().toISOString(),
      },
    });
  }

  /**
   * Mark sample as completed with generated content
   */
  async complete(content, generationMetadata = {}) {
    return this.$query().patchAndFetch({
      status: "completed",
      content,
      metadata: {
        ...this.metadata,
        ...generationMetadata,
        completed_at: new Date().toISOString(),
      },
    });
  }

  /**
   * Mark sample as failed
   */
  async fail(error) {
    return this.$query().patchAndFetch({
      status: "failed",
      metadata: {
        ...this.metadata,
        error: typeof error === "string" ? error : error.message,
        failed_at: new Date().toISOString(),
      },
    });
  }

  /**
   * Find samples by account
   */
  static async findByAccount(appId, accountId) {
    return this.query()
      .where("app_id", appId)
      .where("account_id", accountId)
      .orderBy("created_at", "desc");
  }
}

export default OnboardingSample;
