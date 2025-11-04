/**
 * Add content_type and source_trending_topic_id to post_suggestions
 * Tracks what type of content and which trending topic (if any) generated it
 */

export async function up(knex) {
  await knex.schema.table("post_suggestions", (table) => {
    table.string("content_type", 50).nullable();
    table.uuid("source_trending_topic_id")
      .nullable()
      .references("id")
      .inTable("trending_topics")
      .onDelete("SET NULL");
  });

  // Add indexes
  await knex.schema.alterTable("post_suggestions", (table) => {
    table.index("content_type");
    table.index("source_trending_topic_id");
  });
}

export async function down(knex) {
  await knex.schema.table("post_suggestions", (table) => {
    table.dropColumn("content_type");
    table.dropColumn("source_trending_topic_id");
  });
}
