import BaseModel from "#src/models/BaseModel.js";
import Input from "#src/models/Input.js";
import Account from "#src/models/Account.js";
import App from "#src/models/App.js";
import ArtifactPage from "#src/models/ArtifactPage.js";
import ArtifactActor from "#src/models/ArtifactActor.js";
import SharedView from "#src/models/SharedView.js";

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
        title: { type: "string" },
        metadata: { type: "object" },
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