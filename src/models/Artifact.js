import BaseModel from "#src/models/BaseModel.js";
import Input from "#src/models/Input.js";
import Account from "#src/models/Account.js";
import App from "#src/models/App.js";
import ArtifactPage from "#src/models/ArtifactPage.js";
import ArtifactActor from "#src/models/ArtifactActor.js";
import SharedView from "#src/models/SharedView.js";
import Actor from "#src/models/Actor.js";

class Artifact extends BaseModel {
  static get tableName() {
    return "artifacts";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["input_id", "account_id", "app_id", "artifact_type"],
      properties: {
        ...super.jsonSchema.properties,
        input_id: { type: "string", format: "uuid" },
        account_id: { type: "string", format: "uuid" },
        app_id: { type: "string", format: "uuid" },
        artifact_type: { type: "string", minLength: 1 },
        status: { 
          type: "string", 
          enum: ["pending", "generating", "completed", "failed"],
          default: "pending"
        },
        title: { type: ["string", "null"] },
        subtitle: { type: ["string", "null"] },
        description: { type: ["string", "null"] },
        metadata: { type: "object" },
        
        // Token tracking fields
        total_tokens: { type: ["integer", "null"], minimum: 0 },
        plotline_tokens: { type: ["integer", "null"], minimum: 0 },
        story_tokens: { type: ["integer", "null"], minimum: 0 },
        plotline_prompt_tokens: { type: ["integer", "null"], minimum: 0 },
        plotline_completion_tokens: { type: ["integer", "null"], minimum: 0 },
        story_prompt_tokens: { type: ["integer", "null"], minimum: 0 },
        story_completion_tokens: { type: ["integer", "null"], minimum: 0 },
        
        // Cost and performance
        cost_usd: { type: ["number", "null"], minimum: 0 },
        generation_time_seconds: { type: ["number", "null"], minimum: 0 },
        
        // Model info
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
      pages: {
        relation: BaseModel.HasManyRelation,
        modelClass: ArtifactPage,
        join: {
          from: "artifacts.id",
          to: "artifact_pages.artifact_id",
        },
      },
      shared_views: {
        relation: BaseModel.HasManyRelation,
        modelClass: SharedView,
        join: {
          from: "artifacts.id",
          to: "shared_views.artifact_id",
        },
      },
      artifact_actors: {
        relation: BaseModel.HasManyRelation,
        modelClass: ArtifactActor,
        join: {
          from: "artifacts.id",
          to: "artifact_actors.artifact_id",
        },
      },
      actors: {
        relation: BaseModel.ManyToManyRelation,
        modelClass: Actor,
        join: {
          from: "artifacts.id",
          through: {
            from: "artifact_actors.artifact_id",
            to: "artifact_actors.actor_id",
            extra: ["is_main_character"],
          },
          to: "actors.id",
        },
      },
    };
  }

  static async findByAccountAndApp(accountId, appId, pagination = {}) {
    const query = this.query()
      .where("account_id", accountId)
      .where("app_id", appId)
      .withGraphFetched("[input.media(committed), pages(orderedPages)]")
      .modifiers({
        orderedPages: (builder) => {
          builder.orderBy("page_number", "asc");
        },
        committed: (builder) => {
          builder.where("status", "committed");
        },
      });

    return this.getBasePaginationQuery(query, pagination);
  }

  static async findAccessibleArtifacts(accountId, appId, pagination = {}) {
    const knex = this.knex();
    
    const query = this.query()
      .where((builder) => {
        builder
          .where("artifacts.account_id", accountId)
          .orWhereExists((subquery) => {
            subquery
              .select("*")
              .from("account_links")
              .whereRaw("account_links.linked_account_id = artifacts.account_id")
              .where("account_links.account_id", accountId)
              .where("account_links.app_id", appId)
              .where("account_links.status", "accepted");
          });
      })
      .where("artifacts.app_id", appId)
      .withGraphFetched("[account(publicProfile), input.media(committed), pages(orderedPages)]")
      .modifiers({
        orderedPages: (builder) => {
          builder.orderBy("page_number", "asc");
        },
        committed: (builder) => {
          builder.where("status", "committed");
        },
      });

    return this.getBasePaginationQuery(query, pagination);
  }

  static async findSharedWithAccount(accountId, appId, pagination = {}) {
    const query = this.query()
      .whereExists((subquery) => {
        subquery
          .select("*")
          .from("account_links")
          .whereRaw("account_links.account_id = artifacts.account_id")
          .where("account_links.linked_account_id", accountId)
          .where("account_links.app_id", appId)
          .where("account_links.status", "accepted");
      })
      .where("artifacts.app_id", appId)
      .withGraphFetched("[account(publicProfile), input.media(committed), pages(orderedPages)]")
      .modifiers({
        orderedPages: (builder) => {
          builder.orderBy("page_number", "asc");
        },
        committed: (builder) => {
          builder.where("status", "committed");
        },
      });

    return this.getBasePaginationQuery(query, pagination);
  }

  async getActorsFromInput() {
    if (!this.input) {
      await this.$loadRelated("input");
    }
    return this.input.getActors();
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

  static get modifiers() {
    return {
      withPages(builder) {
        builder.withGraphFetched("[pages(orderedPages)]").modifiers({
          orderedPages: (builder) => {
            builder.orderBy("page_number", "asc");
          },
        });
      },
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