/**
 * Add angle and length columns to post_suggestions table
 */

export async function up(knex) {
  await knex.schema.table("post_suggestions", (table) => {
    table.string("angle").nullable();
    table.string("length").nullable();
  });
}

export async function down(knex) {
  await knex.schema.table("post_suggestions", (table) => {
    table.dropColumn("angle");
    table.dropColumn("length");
  });
}
