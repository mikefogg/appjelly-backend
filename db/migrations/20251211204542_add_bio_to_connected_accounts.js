/**
 * Add bio JSON field to connected_accounts
 * Stores structured Q&A about the user for voice/post generation
 */
export function up(knex) {
  return knex.schema.alterTable("connected_accounts", (table) => {
    table.jsonb("bio").defaultTo("{}");
  });
}

export function down(knex) {
  return knex.schema.alterTable("connected_accounts", (table) => {
    table.dropColumn("bio");
  });
}
