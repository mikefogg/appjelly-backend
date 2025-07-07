import BaseModel from "#src/models/BaseModel.js";
import Artifact from "#src/models/Artifact.js";

class ArtifactPage extends BaseModel {
  static get tableName() {
    return "artifact_pages";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["artifact_id", "page_number"],
      properties: {
        ...super.jsonSchema.properties,
        artifact_id: { type: "string", format: "uuid" },
        page_number: { type: "integer", minimum: 1 },
        text: { type: ["string", "null"] },
        image_key: { type: ["string", "null"] },
        image_prompt: { type: ["string", "null"] },
        image_status: { type: ["string", "null"], enum: ["pending", "generating", "completed", "failed"] },
        layout_data: { type: "object" },
      },
    };
  }

  static get relationMappings() {
    return {
      artifact: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Artifact,
        join: {
          from: "artifact_pages.artifact_id",
          to: "artifacts.id",
        },
      },
    };
  }

  static async findByArtifact(artifactId) {
    return this.query()
      .where("artifact_id", artifactId)
      .orderBy("page_number", "asc");
  }

  static async findPage(artifactId, pageNumber) {
    return this.query()
      .findOne({
        artifact_id: artifactId,
        page_number: pageNumber,
      });
  }

  static async createPages(artifactId, pages) {
    const pageData = pages.map((page, index) => ({
      artifact_id: artifactId,
      page_number: index + 1,
      text: page.text || null,
      image_key: page.image_key || null,
      layout_data: page.layout_data || {},
    }));

    return this.query().insert(pageData);
  }

  static async updatePage(artifactId, pageNumber, updates) {
    return this.query()
      .where("artifact_id", artifactId)
      .where("page_number", pageNumber)
      .update(updates);
  }

  static get modifiers() {
    return {
      ordered(builder) {
        builder.orderBy("page_number", "asc");
      },
      withContent(builder) {
        builder.whereNotNull("text").orWhereNotNull("image_key");
      },
      pageRange(builder, startPage, endPage) {
        builder
          .where("page_number", ">=", startPage)
          .where("page_number", "<=", endPage);
      },
    };
  }
}

export default ArtifactPage;