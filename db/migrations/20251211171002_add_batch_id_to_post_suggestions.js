/**
 * Add batch_id to post_suggestions to track suggestions generated together
 */

export function up(knex) {
  return knex.schema.alterTable("post_suggestions", (table) => {
    table.uuid("batch_id").nullable().index();
  });
}

export function down(knex) {
  return knex.schema.alterTable("post_suggestions", (table) => {
    table.dropColumn("batch_id");
  });
}
