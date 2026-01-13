export async function up(knex) {
  await knex.schema.createTable("onboarding_samples", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE").notNullable();
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE").nullable();

    table.string("platform").notNullable();
    table.jsonb("stats").notNullable(); // { professionalism, spacing, emoji_usage, directness, brevity, humor }
    table.text("input").notNullable(); // the "write about xxx" prompt
    table.integer("version").defaultTo(1).notNullable(); // tracks feedback iterations

    table.string("status").defaultTo("pending").notNullable(); // pending, generating, completed, failed
    table.text("content").nullable(); // generated content

    table.uuid("previous_sample_id").references("id").inTable("onboarding_samples").onDelete("SET NULL").nullable();
    table.text("feedback_input").nullable(); // user's feedback text

    table.jsonb("metadata").defaultTo("{}"); // tokens, costs, generation_time, error, etc.
    table.timestamps(true, true);

    table.index(["app_id", "account_id"]);
    table.index(["status"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("onboarding_samples");
}
