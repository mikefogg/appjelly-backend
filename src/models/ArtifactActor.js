import BaseModel from "#src/models/BaseModel.js";
import Artifact from "#src/models/Artifact.js";
import Actor from "#src/models/Actor.js";

class ArtifactActor extends BaseModel {
  static get tableName() {
    return "artifact_actors";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["artifact_id", "actor_id"],
      properties: {
        ...super.jsonSchema.properties,
        artifact_id: { type: "string", format: "uuid" },
        actor_id: { type: "string", format: "uuid" },
        is_main_character: { type: "boolean", default: false },
      },
    };
  }

  static get relationMappings() {
    return {
      artifact: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Artifact,
        join: {
          from: "artifact_actors.artifact_id",
          to: "artifacts.id",
        },
      },
      actor: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Actor,
        join: {
          from: "artifact_actors.actor_id",
          to: "actors.id",
        },
      },
    };
  }

  // Helper methods for managing artifact-actor relationships
  static async setActorsForArtifact(artifactId, actorIds, mainCharacterIds = [], trx = null) {
    // First, remove any existing relationships for this artifact
    await this.query(trx).where("artifact_id", artifactId).delete();

    // Then create new relationships
    const relationships = actorIds.map(actorId => ({
      artifact_id: artifactId,
      actor_id: actorId,
      is_main_character: mainCharacterIds.includes(actorId),
    }));

    if (relationships.length > 0) {
      await this.query(trx).insert(relationships);
    }

    return relationships;
  }

  static async getActorsForArtifact(artifactId) {
    return this.query()
      .where("artifact_id", artifactId)
      .withGraphFetched("[actor]");
  }

  static async getMainCharactersForArtifact(artifactId) {
    return this.query()
      .where("artifact_id", artifactId)
      .where("is_main_character", true)
      .withGraphFetched("[actor]");
  }

  static async getClaimableActorsForArtifact(artifactId) {
    return this.query()
      .where("artifact_id", artifactId)
      .where("is_main_character", true)
      .withGraphFetched("[actor]")
      .modifyGraph("actor", builder => {
        builder.where("is_claimable", true);
      });
  }

  static get modifiers() {
    return {
      mainCharacters(builder) {
        builder.where("is_main_character", true);
      },
      withActorDetails(builder) {
        builder.withGraphFetched("[actor]");
      },
    };
  }
}

export default ArtifactActor;