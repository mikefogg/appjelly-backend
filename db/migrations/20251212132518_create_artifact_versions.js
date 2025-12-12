/**
 * Create artifact_versions table for post version history
 * Also adds current_version_number to artifacts
 */
export function up(knex) {
  return knex.schema
    .createTable("artifact_versions", (table) => {
      table.uuid("id").primary().defaultTo(knex.fn.uuid());
      table.uuid("artifact_id").notNullable().references("id").inTable("artifacts").onDelete("CASCADE");
      table.integer("version_number").notNullable();
      table.text("content").notNullable();
      table.string("source_type").notNullable(); // creation, generation, improvement, rollback
      table.jsonb("source_metadata").defaultTo("{}");
      table.timestamp("created_at").defaultTo(knex.fn.now());

      // Unique constraint: one version number per artifact
      table.unique(["artifact_id", "version_number"]);

      // Index for fetching versions by artifact
      table.index(["artifact_id", "version_number"]);
    })
    .then(() => {
      return knex.schema.alterTable("artifacts", (table) => {
        table.integer("current_version_number").defaultTo(1);
      });
    });
}

export function down(knex) {
  return knex.schema
    .alterTable("artifacts", (table) => {
      table.dropColumn("current_version_number");
    })
    .then(() => {
      return knex.schema.dropTableIfExists("artifact_versions");
    });
}
