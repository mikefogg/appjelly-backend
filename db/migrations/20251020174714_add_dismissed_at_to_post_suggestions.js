export async function up(knex) {
  // Add dismissed_at timestamp column
  await knex.schema.table("post_suggestions", (table) => {
    table.timestamp("dismissed_at").nullable();
    table.index("dismissed_at");
  });

  // Migrate existing dismissed records
  // Set dismissed_at = updated_at for all status='dismissed' records
  // Then change their status to 'pending'
  await knex("post_suggestions")
    .where("status", "dismissed")
    .update({
      dismissed_at: knex.raw("updated_at"),
      status: "pending",
    });
}

export async function down(knex) {
  // Reverse: Set status='dismissed' for records with dismissed_at
  await knex("post_suggestions")
    .whereNotNull("dismissed_at")
    .update({
      status: "dismissed",
      dismissed_at: null,
    });

  // Drop the column
  await knex.schema.table("post_suggestions", (table) => {
    table.dropColumn("dismissed_at");
  });
}
