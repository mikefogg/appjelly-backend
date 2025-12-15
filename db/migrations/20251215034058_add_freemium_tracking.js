/**
 * Add freemium tracking fields to connected_accounts
 */

export function up(knex) {
  return knex.schema.alterTable("connected_accounts", (table) => {
    // Track number of posts generated for free tier limits
    table.integer("generated_posts_count").defaultTo(0);
    // Timestamp when generation limit was reached (for refresh on payment)
    table.timestamp("generation_limit_reached_at").nullable();
  });
}

export function down(knex) {
  return knex.schema.alterTable("connected_accounts", (table) => {
    table.dropColumn("generated_posts_count");
    table.dropColumn("generation_limit_reached_at");
  });
}
