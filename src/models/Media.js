import BaseModel from "#src/models/BaseModel.js";
import Actor from "#src/models/Actor.js";
import Input from "#src/models/Input.js";
import Account from "#src/models/Account.js";

class Media extends BaseModel {
  static get tableName() {
    return "media";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["owner_type", "owner_id", "image_key"],
      properties: {
        ...super.jsonSchema.properties,
        owner_type: { type: "string", enum: ["actor", "input", "account"] },
        owner_id: { type: "string", format: "uuid" },
        image_key: { type: "string", minLength: 1 },
        status: { type: "string", enum: ["pending", "committed", "expired"], default: "committed" },
        upload_session_id: { type: ["string", "null"], format: "uuid" },
        expires_at: { type: ["string", "null"], format: "date-time" },
        metadata: { type: "object" },
      },
    };
  }

  static get relationMappings() {
    return {
      actor: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Actor,
        join: {
          from: "media.owner_id",
          to: "actors.id",
        },
        filter: {
          owner_type: "actor",
        },
      },
      input: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Input,
        join: {
          from: "media.owner_id",
          to: "inputs.id",
        },
        filter: {
          owner_type: "input",
        },
      },
      account: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Account,
        join: {
          from: "media.owner_id",
          to: "accounts.id",
        },
        filter: {
          owner_type: "account",
        },
      },
    };
  }

  static async findByOwner(ownerType, ownerId) {
    return this.query()
      .where("owner_type", ownerType)
      .where("owner_id", ownerId)
      .orderBy("created_at", "desc");
  }

  static async createForActor(actorId, imageKey, metadata = {}) {
    return this.query().insert({
      owner_type: "actor",
      owner_id: actorId,
      image_key: imageKey,
      metadata,
    });
  }

  static async createForInput(inputId, imageKey, metadata = {}) {
    return this.query().insert({
      owner_type: "input",
      owner_id: inputId,
      image_key: imageKey,
      metadata,
    });
  }

  static async createForAccount(accountId, imageKey, metadata = {}) {
    return this.query().insert({
      owner_type: "account",
      owner_id: accountId,
      image_key: imageKey,
      metadata,
    });
  }

  // Pending upload methods
  static async createPendingUpload(uploadSessionId, imageKey, accountId, metadata = {}) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiration

    return this.query().insert({
      owner_type: "account", // Default to account until committed to specific owner
      owner_id: accountId, // Set to the account creating the session
      upload_session_id: uploadSessionId,
      image_key: imageKey, // Always have image_key from Cloudflare
      status: "pending",
      expires_at: expiresAt.toISOString(),
      metadata,
    });
  }

  static async findPendingBySessionId(uploadSessionId) {
    return this.query()
      .where("upload_session_id", uploadSessionId)
      .where("status", "pending")
      .where("expires_at", ">", new Date().toISOString())
      .orderBy("created_at", "desc");
  }

  static async commitPendingMedia(uploadSessionId, ownerType, ownerId) {
    return this.query()
      .where("upload_session_id", uploadSessionId)
      .where("status", "pending")
      .where("expires_at", ">", new Date().toISOString())
      .patch({
        owner_type: ownerType,
        owner_id: ownerId,
        status: "committed",
        upload_session_id: null,
        expires_at: null,
      });
  }

  static async cleanupExpiredPending() {
    const expiredMedia = await this.query()
      .where("status", "pending")
      .where("expires_at", "<=", new Date().toISOString());

    // Mark as expired first
    await this.query()
      .where("status", "pending")
      .where("expires_at", "<=", new Date().toISOString())
      .patch({ status: "expired" });

    return expiredMedia;
  }

  static async findCommittedByOwner(ownerType, ownerId) {
    return this.query()
      .where("owner_type", ownerType)
      .where("owner_id", ownerId)
      .where("status", "committed")
      .orderBy("created_at", "desc");
  }

  static get modifiers() {
    return {
      forActor(builder) {
        builder.where("owner_type", "actor");
      },
      forInput(builder) {
        builder.where("owner_type", "input");
      },
      forAccount(builder) {
        builder.where("owner_type", "account");
      },
      committed(builder) {
        builder.where("status", "committed");
      },
      pending(builder) {
        builder.where("status", "pending");
      },
      notExpired(builder) {
        builder.where((subBuilder) => {
          subBuilder
            .whereNull("expires_at")
            .orWhere("expires_at", ">", new Date().toISOString());
        });
      },
      publicInfo(builder) {
        builder.select("id", "image_key", "metadata", "created_at", "status");
      },
      sessionInfo(builder) {
        builder.select("id", "image_key", "upload_session_id", "status", "expires_at", "metadata", "created_at");
      },
    };
  }
}

export default Media;