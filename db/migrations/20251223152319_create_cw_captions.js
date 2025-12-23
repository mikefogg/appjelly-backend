/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.createTable("cw_captions", (table) => {
    table.integer("id").primary();
    table.text("local_id"); // text - can be long UUIDs
    table.integer("user_id").notNullable();
    table.text("name"); // text - caption names can be long
    table.text("content");
    table.integer("count_hashtags");
    table.integer("count_characters");
    table.text("folder_id"); // text - references folder local_id
    table.string("network");
    table.string("network_placement");
    table.timestamp("created_at");
    table.timestamp("updated_at");
    // Migration tracking
    table.uuid("ghost_artifact_id").references("id").inTable("artifacts").onDelete("SET NULL");
    table.timestamp("migrated_at");
    table.jsonb("migration_error");

    table.index(["user_id"]);
    table.index(["folder_id"]);
    table.index(["migrated_at"]);
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists("cw_captions");
}
