/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function up(knex) {
  return knex.schema.alterTable('media', function (table) {
    // Add video-specific fields
    table.string('video_key').nullable();
    table.string('video_filename').nullable();
    table.string('video_format').nullable();
    table.integer('video_duration_seconds').nullable();
    table.bigInteger('video_size_bytes').nullable();
    table.integer('video_width').nullable();
    table.integer('video_height').nullable();
    table.integer('video_fps').nullable();
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function down(knex) {
  return knex.schema.alterTable('media', function (table) {
    table.dropColumn('video_key');
    table.dropColumn('video_filename');
    table.dropColumn('video_format');
    table.dropColumn('video_duration_seconds');
    table.dropColumn('video_size_bytes');
    table.dropColumn('video_width');
    table.dropColumn('video_height');
    table.dropColumn('video_fps');
  });
}