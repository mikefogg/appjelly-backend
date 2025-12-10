/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function up(knex) {
  return knex.schema.alterTable("subscriptions", (table) => {
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");
    table.index("app_id");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function down(knex) {
  return knex.schema.alterTable("subscriptions", (table) => {
    table.dropColumn("app_id");
  });
}
