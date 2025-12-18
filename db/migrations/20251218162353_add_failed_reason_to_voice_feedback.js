/**
 * Add failed_reason column to voice_feedback table
 */
export function up(knex) {
  return knex.schema.alterTable("voice_feedback", (table) => {
    table.text("failed_reason");
  });
}

export function down(knex) {
  return knex.schema.alterTable("voice_feedback", (table) => {
    table.dropColumn("failed_reason");
  });
}
