export async function up(knex) {
  await knex.schema.table("connected_accounts", (table) => {
    table.boolean("is_default").defaultTo(false).notNullable();
    table.boolean("is_deletable").defaultTo(true).notNullable();
  });
}

export async function down(knex) {
  await knex.schema.table("connected_accounts", (table) => {
    table.dropColumn("is_default");
    table.dropColumn("is_deletable");
  });
}
