import BaseModel from "#src/models/BaseModel.js";
import Artifact from "#src/models/Artifact.js";

class ArtifactVersion extends BaseModel {
  static get tableName() {
    return "artifact_versions";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["artifact_id", "version_number", "content", "source_type"],
      properties: {
        id: { type: "string", format: "uuid" },
        artifact_id: { type: "string", format: "uuid" },
        version_number: { type: "integer", minimum: 1 },
        content: { type: "string" },
        source_type: {
          type: "string",
          enum: ["creation", "generation", "improvement", "rollback"],
        },
        source_metadata: { type: "object" },
        created_at: { type: "string", format: "date-time" },
      },
    };
  }

  // No updated_at for versions - they're immutable snapshots
  static get timestamps() {
    return ["created_at"];
  }

  $beforeInsert() {
    this.created_at = new Date().toISOString();
  }

  $beforeUpdate() {
    // Versions are immutable, but we allow content updates for the current version
  }

  static get relationMappings() {
    return {
      artifact: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Artifact,
        join: {
          from: "artifact_versions.artifact_id",
          to: "artifacts.id",
        },
      },
    };
  }

  /**
   * Create the first version for an artifact (idempotent - returns existing if already created)
   */
  static async createInitialVersion(artifactId, content, sourceType, sourceMetadata = {}) {
    // Check if v1 already exists
    const existing = await this.getVersion(artifactId, 1);
    if (existing) {
      return existing;
    }

    return this.query().insert({
      artifact_id: artifactId,
      version_number: 1,
      content,
      source_type: sourceType,
      source_metadata: sourceMetadata,
    });
  }

  /**
   * Create a new version for an artifact
   */
  static async createVersion(artifactId, content, sourceType, sourceMetadata = {}) {
    // Get the current max version number
    const maxVersion = await this.query()
      .where("artifact_id", artifactId)
      .max("version_number as max")
      .first();

    const newVersionNumber = (maxVersion?.max || 0) + 1;

    return this.query().insert({
      artifact_id: artifactId,
      version_number: newVersionNumber,
      content,
      source_type: sourceType,
      source_metadata: sourceMetadata,
    });
  }

  /**
   * Get all versions for an artifact
   */
  static async getVersions(artifactId) {
    return this.query()
      .where("artifact_id", artifactId)
      .orderBy("version_number", "desc");
  }

  /**
   * Get a specific version
   */
  static async getVersion(artifactId, versionNumber) {
    return this.query()
      .where("artifact_id", artifactId)
      .where("version_number", versionNumber)
      .first();
  }

  /**
   * Get the current (latest) version
   */
  static async getCurrentVersion(artifactId) {
    return this.query()
      .where("artifact_id", artifactId)
      .orderBy("version_number", "desc")
      .first();
  }

  /**
   * Update content of the current version (for manual edits)
   */
  static async updateCurrentVersionContent(artifactId, content) {
    const current = await this.getCurrentVersion(artifactId);
    if (current) {
      return current.$query().patchAndFetch({ content });
    }
    return null;
  }

  /**
   * Get version count for an artifact
   */
  static async getVersionCount(artifactId) {
    const result = await this.query()
      .where("artifact_id", artifactId)
      .count("id as count")
      .first();
    return parseInt(result?.count || 0, 10);
  }
}

export default ArtifactVersion;
