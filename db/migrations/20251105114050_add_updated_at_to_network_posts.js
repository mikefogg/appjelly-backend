/**
 * Add updated_at to network_posts
 * Required by BaseModel for automatic timestamp tracking
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.table("network_posts", (table) => {
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.table("network_posts", (table) => {
    table.dropColumn("updated_at");
  });
}
