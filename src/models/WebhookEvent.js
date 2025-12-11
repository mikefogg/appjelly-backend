import BaseModel from "#src/models/BaseModel.js";
import App from "#src/models/App.js";

class WebhookEvent extends BaseModel {
  static get tableName() {
    return "webhook_events";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["source", "payload"],
      properties: {
        ...super.jsonSchema.properties,
        app_id: { type: ["string", "null"], format: "uuid" },
        source: { type: "string", minLength: 1, maxLength: 50 },
        event_type: { type: ["string", "null"], maxLength: 100 },
        event_id: { type: ["string", "null"], maxLength: 255 },
        payload: { type: "object" },
        status: { type: "string", enum: ["received", "processed", "failed"] },
        error_message: { type: ["string", "null"] },
        retry_count: { type: "integer", minimum: 0 },
        processed_at: { type: ["string", "null"], format: "date-time" },
      },
    };
  }

  static get relationMappings() {
    return {
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "webhook_events.app_id",
          to: "apps.id",
        },
      },
    };
  }

  static async logEvent({ source, eventType, eventId, payload, appId }) {
    return this.query().insert({
      source,
      event_type: eventType,
      event_id: eventId,
      payload,
      app_id: appId || null,
      status: "received",
    });
  }

  async markProcessed() {
    return this.$query().patch({
      status: "processed",
      processed_at: new Date().toISOString(),
    });
  }

  async markFailed(errorMessage) {
    return this.$query().patch({
      status: "failed",
      error_message: errorMessage,
      retry_count: this.retry_count + 1,
    });
  }

  static async findUnprocessed(source, limit = 100) {
    return this.query()
      .where("source", source)
      .where("status", "received")
      .orderBy("created_at", "asc")
      .limit(limit);
  }

  static async findFailed(source, limit = 100) {
    return this.query()
      .where("source", source)
      .where("status", "failed")
      .orderBy("created_at", "asc")
      .limit(limit);
  }

  static get modifiers() {
    return {
      bySource(builder, source) {
        builder.where("source", source);
      },
      unprocessed(builder) {
        builder.where("status", "received");
      },
      failed(builder) {
        builder.where("status", "failed");
      },
      recent(builder) {
        builder.orderBy("created_at", "desc");
      },
    };
  }
}

export default WebhookEvent;
