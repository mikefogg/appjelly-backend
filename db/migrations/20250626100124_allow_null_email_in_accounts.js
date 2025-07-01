export async function up(knex) {
  await knex.schema.alterTable("accounts", (table) => {
    table.string("email").nullable().alter();
  });
}

export async function down(knex) {
  await knex.schema.alterTable("accounts", (table) => {
    table.string("email").notNullable().alter();
  });
}