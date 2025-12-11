/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function up(knex) {
  return knex.schema.createTable("voice_profiles", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table
      .uuid("connected_account_id")
      .notNullable()
      .references("id")
      .inTable("connected_accounts")
      .onDelete("CASCADE");

    table.integer("version").notNullable().defaultTo(1);
    table
      .enum("status", ["generating", "active"])
      .notNullable()
      .defaultTo("generating");

    // Voice characteristics
    table.text("voice_summary");
    table.text("sentence_patterns");
    table.text("vocabulary_notes");
    table.text("tone_markers");
    table.text("formatting_habits");
    table.jsonb("hard_rules").defaultTo("[]");

    // Example outputs for standard prompts
    table.jsonb("examples").defaultTo("{}");

    // Confidence and reasoning
    table.float("confidence").defaultTo(0);
    table.text("confidence_reasoning");

    // Hash of inputs used to generate this profile
    table.string("input_hash");

    table.timestamps(true, true);

    // Index for fast lookup of current active profile
    table.index(["connected_account_id", "status", "version"]);
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function down(knex) {
  return knex.schema.dropTable("voice_profiles");
}
