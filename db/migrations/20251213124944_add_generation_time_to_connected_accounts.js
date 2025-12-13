/**
 * Add optional generation_time override to connected_accounts
 * Allows each connection to have its own posting schedule
 * If null, falls back to account-level generation_time
 */

export async function up(knex) {
  await knex.schema.alterTable("connected_accounts", (table) => {
    // Local hour (0-23) - optional override of account.generation_time
    table.integer("generation_time").nullable();
    // Calculated UTC hour based on account's timezone
    table.integer("generation_time_utc").nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable("connected_accounts", (table) => {
    table.dropColumn("generation_time");
    table.dropColumn("generation_time_utc");
  });
}
