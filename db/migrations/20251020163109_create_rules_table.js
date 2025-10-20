export async function up(knex) {
  await knex.schema.createTable("rules", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("connected_account_id").references("id").inTable("connected_accounts").onDelete("CASCADE").notNullable();

    // Rule type categorization
    table.enum("rule_type", ["never", "always", "prefer", "tone"]).notNullable();

    // Rule content
    table.text("content").notNullable();

    // Link to suggestion for feedback (null = general rule)
    table.uuid("feedback_on_suggestion_id").references("id").inTable("post_suggestions").onDelete("SET NULL").nullable();

    // Priority and activation
    table.integer("priority").defaultTo(5); // 1-10, higher = more important
    table.boolean("is_active").defaultTo(true);

    table.timestamps(true, true);

    // Indexes for efficient querying
    table.index(["connected_account_id"]);
    table.index(["connected_account_id", "is_active"]);
    table.index(["connected_account_id", "feedback_on_suggestion_id"]);
    table.index(["feedback_on_suggestion_id"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("rules");
}
