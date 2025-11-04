/**
 * Add content rotation tracking fields to connected_accounts
 * Tracks last content type posted and enables rotation feature
 */

export async function up(knex) {
  await knex.schema.table("connected_accounts", (table) => {
    table.string("last_content_type", 50).nullable();
    table.timestamp("last_posted_at").nullable();
    table.boolean("content_rotation_enabled").defaultTo(true);
  });

  // Add indexes for querying
  await knex.schema.alterTable("connected_accounts", (table) => {
    table.index("last_posted_at");
  });
}

export async function down(knex) {
  await knex.schema.table("connected_accounts", (table) => {
    table.dropColumn("last_content_type");
    table.dropColumn("last_posted_at");
    table.dropColumn("content_rotation_enabled");
  });
}
