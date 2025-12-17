/**
 * Add voice_update_pending_at column to track when a voice update is queued (debouncing)
 * This is separate from voice_update_started_at which tracks when generation actually begins
 */
export function up(knex) {
  return knex.schema.alterTable("connected_accounts", (table) => {
    table.timestamp("voice_update_pending_at").nullable();
  });
}

export function down(knex) {
  return knex.schema.alterTable("connected_accounts", (table) => {
    table.dropColumn("voice_update_pending_at");
  });
}
