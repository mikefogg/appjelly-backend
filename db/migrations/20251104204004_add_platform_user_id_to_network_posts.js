/**
 * Add platform_user_id to network_posts
 * Stores the external platform user ID for curated posts (posts from other users)
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.table("network_posts", (table) => {
    table.string("platform_user_id", 255).nullable();
    table.index("platform_user_id", "network_posts_platform_user_id_index");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.table("network_posts", (table) => {
    table.dropIndex("platform_user_id", "network_posts_platform_user_id_index");
    table.dropColumn("platform_user_id");
  });
}
