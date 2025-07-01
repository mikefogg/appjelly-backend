import Knex from "knex";
import connection from "#root/knexfile.js";
import { Model } from "objection";

const knexConnection = Knex(connection);
Model.knex(knexConnection);

export { default as BaseModel } from "#src/models/BaseModel.js";
export { default as App } from "#src/models/App.js";
export { default as Account } from "#src/models/Account.js";
export { default as AccountLink } from "#src/models/AccountLink.js";
export { default as Actor } from "#src/models/Actor.js";
export { default as Media } from "#src/models/Media.js";
export { default as Input } from "#src/models/Input.js";
export { default as Artifact } from "#src/models/Artifact.js";
export { default as ArtifactActor } from "#src/models/ArtifactActor.js";
export { default as ArtifactPage } from "#src/models/ArtifactPage.js";
export { default as SharedView } from "#src/models/SharedView.js";
export { default as Subscription } from "#src/models/Subscription.js";

export { knexConnection as knex };