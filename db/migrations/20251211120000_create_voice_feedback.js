/**
 * Create voice_feedback table for storing user feedback on generated content
 */
export function up(knex) {
  return knex.schema.createTable("voice_feedback", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.uuid("connected_account_id").notNullable()
      .references("id").inTable("connected_accounts").onDelete("CASCADE");

    // The feedback content
    table.text("feedback").notNullable(); // "This is too wordy"
    table.text("reference_text"); // The text they're commenting on (optional)

    // Processing status
    table.enum("status", ["pending", "processing", "processed", "failed"])
      .notNullable().defaultTo("pending");

    // Results after processing
    table.integer("applied_to_version"); // Which voice profile version incorporated this
    table.text("ai_reasoning"); // What AI changed and why

    // Timestamps
    table.timestamps(true, true);
    table.timestamp("processed_at");

    // Indexes
    table.index(["connected_account_id", "status"]);
    table.index(["connected_account_id", "created_at"]);
  });
}

export function down(knex) {
  return knex.schema.dropTableIfExists("voice_feedback");
}
