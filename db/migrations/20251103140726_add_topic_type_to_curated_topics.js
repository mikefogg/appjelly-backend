/**
 * Add topic_type field to curated_topics table
 * Supports: 'realtime' (news/current events), 'evergreen' (timeless content), 'hybrid' (both)
 */

export async function up(knex) {
  await knex.schema.table("curated_topics", (table) => {
    table.string("topic_type", 20).defaultTo("realtime");
  });

  // Add check constraint
  await knex.raw(`
    ALTER TABLE curated_topics
    ADD CONSTRAINT curated_topics_topic_type_check
    CHECK (topic_type IN ('realtime', 'evergreen', 'hybrid'))
  `);

  // Make twitter_list_id nullable since evergreen topics don't need it
  await knex.schema.alterTable("curated_topics", (table) => {
    table.string("twitter_list_id").nullable().alter();
  });
}

export async function down(knex) {
  await knex.schema.table("curated_topics", (table) => {
    table.dropColumn("topic_type");
  });

  // Restore twitter_list_id as not nullable
  await knex.schema.alterTable("curated_topics", (table) => {
    table.string("twitter_list_id").notNullable().alter();
  });
}
