/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable("cw_folders", (table) => {
    table.integer("id").primary();
    table.text("local_id"); // text - can be long UUIDs
    table.integer("user_id").notNullable();
    table.text("name"); // text - folder names can be long
    table.text("folder_id"); // text - parent folder reference (local_id)
    table.string("network");
    table.timestamp("created_at");
    table.timestamp("updated_at");

    table.index(["user_id"]);
    table.index(["folder_id"]);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists("cw_folders");
};
