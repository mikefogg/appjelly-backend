export async function up(knex) {
  await knex.schema.createTable("trending_topics", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("curated_topic_id").references("id").inTable("curated_topics").onDelete("CASCADE").notNullable();
    table.string("topic_name", 500).notNullable();
    table.text("context"); // AI-generated summary
    table.integer("mention_count").defaultTo(0);
    table.decimal("total_engagement", 10, 2).defaultTo(0);
    table.jsonb("sample_post_ids"); // array of network_post ids
    table.timestamp("detected_at").notNullable();
    table.timestamp("expires_at").nullable(); // 48 hours from detected_at
    table.timestamps(true, true);

    // Indexes
    table.index(["curated_topic_id"]);
    table.index(["expires_at"]);
    table.index(["curated_topic_id", "expires_at"]);
    table.index(["detected_at"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("trending_topics");
}
