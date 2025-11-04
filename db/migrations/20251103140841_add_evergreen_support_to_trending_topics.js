/**
 * Add evergreen topic support to trending_topics
 * Adds topic_type, rotation_group for daily rotation, and sort_order
 */

export async function up(knex) {
  await knex.schema.table("trending_topics", (table) => {
    table.string("topic_type", 20).defaultTo("realtime");
    table.integer("rotation_group").nullable(); // 1-7 for daily rotation
    table.integer("sort_order").defaultTo(0);
  });

  // Add check constraint for topic_type
  await knex.raw(`
    ALTER TABLE trending_topics
    ADD CONSTRAINT trending_topics_topic_type_check
    CHECK (topic_type IN ('realtime', 'evergreen'))
  `);

  // Add indexes
  await knex.schema.alterTable("trending_topics", (table) => {
    table.index(["curated_topic_id", "topic_type"]);
    table.index(["curated_topic_id", "rotation_group"]);
  });

  // Make expires_at nullable since evergreen topics don't expire
  await knex.schema.alterTable("trending_topics", (table) => {
    table.timestamp("expires_at").nullable().alter();
  });
}

export async function down(knex) {
  await knex.schema.table("trending_topics", (table) => {
    table.dropColumn("topic_type");
    table.dropColumn("rotation_group");
    table.dropColumn("sort_order");
  });

  // Restore expires_at as not nullable
  await knex.schema.alterTable("trending_topics", (table) => {
    table.timestamp("expires_at").notNullable().alter();
  });
}
