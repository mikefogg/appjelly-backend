export async function up(knex) {
  await knex.schema.alterTable("network_posts", (table) => {
    // Add curated_topic_id reference
    table.uuid("curated_topic_id").references("id").inTable("curated_topics").onDelete("SET NULL").nullable();

    // Make connected_account_id nullable (curated posts won't have a specific user)
    table.uuid("connected_account_id").nullable().alter();

    // Add index for curated_topic_id
    table.index(["curated_topic_id"]);
  });
}

export async function down(knex) {
  await knex.schema.alterTable("network_posts", (table) => {
    // Drop the index first
    table.dropIndex(["curated_topic_id"]);

    // Remove curated_topic_id column
    table.dropColumn("curated_topic_id");

    // Make connected_account_id not nullable again
    table.uuid("connected_account_id").notNullable().alter();
  });
}
