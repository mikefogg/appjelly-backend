export async function up(knex) {
  await knex.schema.createTable("curated_topics", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("slug", 100).unique().notNullable();
    table.string("name", 255).notNullable();
    table.text("description");
    table.string("twitter_list_id", 255).nullable();
    table.boolean("is_active").defaultTo(true);
    table.timestamp("last_synced_at").nullable();
    table.timestamp("last_digested_at").nullable();
    table.timestamps(true, true);

    // Indexes
    table.index(["slug"]);
    table.index(["is_active"]);
    table.index(["twitter_list_id"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("curated_topics");
}
