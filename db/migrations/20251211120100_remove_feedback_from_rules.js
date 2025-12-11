/**
 * Remove feedback_on_suggestion_id from rules table
 * Feedback is now handled via voice_feedback table
 */
export function up(knex) {
  return knex.schema.alterTable("rules", (table) => {
    table.dropIndex(["connected_account_id", "feedback_on_suggestion_id"]);
    table.dropIndex(["feedback_on_suggestion_id"]);
    table.dropForeign("feedback_on_suggestion_id");
    table.dropColumn("feedback_on_suggestion_id");
  });
}

export function down(knex) {
  return knex.schema.alterTable("rules", (table) => {
    table.uuid("feedback_on_suggestion_id")
      .references("id").inTable("post_suggestions").onDelete("SET NULL").nullable();
    table.index(["connected_account_id", "feedback_on_suggestion_id"]);
    table.index(["feedback_on_suggestion_id"]);
  });
}
