import Knex from "knex";
import connection from "#root/knexfile.js";
import { Model } from "objection";

const knexConnection = Knex(connection);
Model.knex(knexConnection);

export { default as BaseModel } from "#src/models/BaseModel.js";
export { default as App } from "#src/models/App.js";
export { default as Account } from "#src/models/Account.js";
export { default as Media } from "#src/models/Media.js";
export { default as Input } from "#src/models/Input.js";
export { default as Artifact } from "#src/models/Artifact.js";
export { default as Subscription } from "#src/models/Subscription.js";

// Ghost models
export { default as ConnectedAccount } from "#src/models/ConnectedAccount.js";
export { default as NetworkProfile } from "#src/models/NetworkProfile.js";
export { default as NetworkPost } from "#src/models/NetworkPost.js";
export { default as UserPostHistory } from "#src/models/UserPostHistory.js";
export { default as PostSuggestion } from "#src/models/PostSuggestion.js";
export { default as WritingStyle } from "#src/models/WritingStyle.js";

export { knexConnection as knex };
