/**
 * Add topics_of_interest field to connected_accounts
 * Stores what topics the user likes to write about (for suggestion generation)
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.table("connected_accounts", (table) => {
    table.text("topics_of_interest").nullable();
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.table("connected_accounts", (table) => {
    table.dropColumn("topics_of_interest");
  });
}
