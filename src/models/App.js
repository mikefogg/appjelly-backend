import BaseModel from "#src/models/BaseModel.js";
import Account from "#src/models/Account.js";
import Input from "#src/models/Input.js";
import Artifact from "#src/models/Artifact.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";

class App extends BaseModel {
  static get tableName() {
    return "apps";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["slug", "name"],
      properties: {
        ...super.jsonSchema.properties,
        slug: { type: "string", minLength: 1, maxLength: 100 },
        name: { type: "string", minLength: 1, maxLength: 255 },
        config: { type: "object" },
      },
    };
  }

  static get relationMappings() {
    return {
      accounts: {
        relation: BaseModel.HasManyRelation,
        modelClass: Account,
        join: {
          from: "apps.id",
          to: "accounts.app_id",
        },
      },
      inputs: {
        relation: BaseModel.HasManyRelation,
        modelClass: Input,
        join: {
          from: "apps.id",
          to: "inputs.app_id",
        },
      },
      artifacts: {
        relation: BaseModel.HasManyRelation,
        modelClass: Artifact,
        join: {
          from: "apps.id",
          to: "artifacts.app_id",
        },
      },
      connected_accounts: {
        relation: BaseModel.HasManyRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "apps.id",
          to: "connected_accounts.app_id",
        },
      },
    };
  }

  static async findBySlug(slug) {
    return this.query().findOne({ slug });
  }

  static get modifiers() {
    return {
      publicConfig(builder) {
        builder.select("id", "slug", "name", "config");
      },
    };
  }
}

export default App;