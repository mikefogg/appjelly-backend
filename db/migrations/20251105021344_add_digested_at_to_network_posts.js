/**
 * Add digested_at to network_posts
 * Tracks when a post was included in a digest/trending topics analysis
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.table("network_posts", (table) => {
    table.timestamp("digested_at").nullable();
    table.index("digested_at", "network_posts_digested_at_index");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.table("network_posts", (table) => {
    table.dropIndex("digested_at", "network_posts_digested_at_index");
    table.dropColumn("digested_at");
  });
}
