/**
 * Add unique constraint to user_post_history for (connected_account_id, post_id)
 */

export async function up(knex) {
  await knex.schema.alterTable('user_post_history', (table) => {
    table.unique(['connected_account_id', 'post_id']);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('user_post_history', (table) => {
    table.dropUnique(['connected_account_id', 'post_id']);
  });
}
