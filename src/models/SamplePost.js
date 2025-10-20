import BaseModel from "#src/models/BaseModel.js";
import ConnectedAccount from "#src/models/ConnectedAccount.js";

class SamplePost extends BaseModel {
  static get tableName() {
    return "sample_posts";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["connected_account_id", "content"],
      properties: {
        ...super.jsonSchema.properties,
        connected_account_id: { type: "string", format: "uuid" },
        content: { type: "string", minLength: 1 },
        notes: { type: ["string", "null"] },
        sort_order: { type: "integer", default: 0 },
        metadata: { type: "object" },
      },
    };
  }

  static get relationMappings() {
    return {
      connected_account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ConnectedAccount,
        join: {
          from: "sample_posts.connected_account_id",
          to: "connected_accounts.id",
        },
      },
    };
  }
}

export default SamplePost;
