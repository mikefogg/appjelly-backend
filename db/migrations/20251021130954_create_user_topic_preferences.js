export async function up(knex) {
  await knex.schema.createTable("user_topic_preferences", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("connected_account_id").references("id").inTable("connected_accounts").onDelete("CASCADE").notNullable();
    table.uuid("curated_topic_id").references("id").inTable("curated_topics").onDelete("CASCADE").notNullable();
    table.timestamps(true, true);

    // Ensure unique preference per user per topic
    table.unique(["connected_account_id", "curated_topic_id"]);

    // Indexes
    table.index(["connected_account_id"]);
    table.index(["curated_topic_id"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("user_topic_preferences");
}
