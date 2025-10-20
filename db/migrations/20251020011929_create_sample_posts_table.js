export async function up(knex) {
  await knex.schema.createTable("sample_posts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("connected_account_id").references("id").inTable("connected_accounts").onDelete("CASCADE").notNullable();

    // Sample post content
    table.text("content").notNullable();
    table.text("notes").nullable(); // Optional notes about why this sample is good

    // Ordering for display
    table.integer("sort_order").defaultTo(0);

    table.timestamps(true, true);

    table.index(["connected_account_id"]);
    table.index(["connected_account_id", "sort_order"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("sample_posts");
}
