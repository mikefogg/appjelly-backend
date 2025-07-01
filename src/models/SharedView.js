import BaseModel from "#src/models/BaseModel.js";
import { randomBytes } from "crypto";
import Artifact from "#src/models/Artifact.js";

class SharedView extends BaseModel {
  static get tableName() {
    return "shared_views";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["artifact_id", "token"],
      properties: {
        ...super.jsonSchema.properties,
        artifact_id: { type: "string", format: "uuid" },
        token: { type: "string", minLength: 1 },
        permissions: { type: "object" },
        metadata: { type: "object" },
      },
    };
  }

  static get relationMappings() {
    return {
      artifact: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Artifact,
        join: {
          from: "shared_views.artifact_id",
          to: "artifacts.id",
        },
      },
    };
  }

  static generateToken() {
    return `share_${randomBytes(16).toString("hex")}`;
  }

  static async createSharedView(artifactId, permissions = {}, metadata = {}) {
    const token = this.generateToken();
    
    return this.query().insert({
      artifact_id: artifactId,
      token,
      permissions,
      metadata,
    });
  }

  static async findByToken(token) {
    return this.query()
      .findOne({ token })
      .withGraphFetched("[artifact.[input, pages(ordered), account(publicProfile)]]")
      .modifiers({
        ordered: (builder) => {
          builder.orderBy("page_number", "asc");
        },
      });
  }

  static async findByArtifact(artifactId) {
    return this.query()
      .where("artifact_id", artifactId)
      .orderBy("created_at", "desc");
  }

  isExpired() {
    if (!this.metadata?.expires_at) {
      return false;
    }
    return new Date(this.metadata.expires_at) < new Date();
  }

  hasPermission(permission) {
    return this.permissions?.[permission] === true;
  }

  static get modifiers() {
    return {
      active(builder) {
        builder.where((subBuilder) => {
          subBuilder
            .whereNull("metadata->expires_at")
            .orWhere("metadata->expires_at", ">", new Date().toISOString());
        });
      },
      withArtifact(builder) {
        builder.withGraphFetched("[artifact]");
      },
      recent(builder) {
        builder.orderBy("created_at", "desc");
      },
    };
  }
}

export default SharedView;