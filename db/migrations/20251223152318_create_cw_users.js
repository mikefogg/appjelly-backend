/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.createTable("cw_users", (table) => {
    table.integer("id").primary();
    table.string("email").notNullable();
    table.timestamp("created_at");
    table.timestamp("updated_at");
    // Migration tracking
    table.uuid("ghost_account_id").references("id").inTable("accounts").onDelete("SET NULL");
    table.timestamp("migrated_at");

    table.index(["email"]);
    table.index(["ghost_account_id"]);
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists("cw_users");
}
