/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function up(knex) {
  return knex.schema.table('media', function (table) {
    table.string('audio_timing_key').nullable().after('audio_text');
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function down(knex) {
  return knex.schema.table('media', function (table) {
    table.dropColumn('audio_timing_key');
  });
}