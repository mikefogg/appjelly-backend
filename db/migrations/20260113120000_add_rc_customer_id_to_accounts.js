/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.alterTable("accounts", (table) => {
    table.string("rc_customer_id");
    table.index(["rc_customer_id"]);
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.alterTable("accounts", (table) => {
    table.dropIndex(["rc_customer_id"]);
    table.dropColumn("rc_customer_id");
  });
}
