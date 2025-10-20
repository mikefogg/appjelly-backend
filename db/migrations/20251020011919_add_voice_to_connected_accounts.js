export async function up(knex) {
  await knex.schema.table("connected_accounts", (table) => {
    table.text("voice").nullable();
  });
}

export async function down(knex) {
  await knex.schema.table("connected_accounts", (table) => {
    table.dropColumn("voice");
  });
}
