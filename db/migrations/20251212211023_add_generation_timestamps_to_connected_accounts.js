/**
 * Add generation timestamps to connected_accounts
 * These are set when jobs start and cleared when they complete
 * Used to show "generating" status in UI
 */

export async function up(knex) {
  await knex.schema.alterTable("connected_accounts", (table) => {
    table.timestamp("voice_update_started_at").nullable();
    table.timestamp("suggestions_update_started_at").nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable("connected_accounts", (table) => {
    table.dropColumn("voice_update_started_at");
    table.dropColumn("suggestions_update_started_at");
  });
}
