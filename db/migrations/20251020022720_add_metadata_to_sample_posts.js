/**
 * Add metadata column to sample_posts for tracking auto-generation
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.table("sample_posts", (table) => {
    table.jsonb("metadata").defaultTo("{}");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.table("sample_posts", (table) => {
    table.dropColumn("metadata");
  });
}
