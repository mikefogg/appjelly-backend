/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function up(knex) {
  return knex.schema.alterTable("connected_accounts", (table) => {
    table.string("brand_scope").defaultTo("personal");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function down(knex) {
  return knex.schema.alterTable("connected_accounts", (table) => {
    table.dropColumn("brand_scope");
  });
}
