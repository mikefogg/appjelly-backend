export async function up(knex) {
  await knex.schema.alterTable("connected_accounts", (table) => {
    table.string("platform_user_id").nullable().alter();
    table.text("access_token").nullable().alter();
  });
}

export async function down(knex) {
  await knex.schema.alterTable("connected_accounts", (table) => {
    table.string("platform_user_id").notNullable().alter();
    table.text("access_token").notNullable().alter();
  });
}
