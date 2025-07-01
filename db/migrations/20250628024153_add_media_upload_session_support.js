/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex.schema.alterTable('media', function(table) {
    // Add status field to track media lifecycle: 'pending', 'committed', 'expired'
    table.string('status').defaultTo('committed').notNullable();
    
    // Add upload session ID for grouping pending uploads
    table.uuid('upload_session_id').nullable();
    
    // Add expiration timestamp for pending uploads (24 hour TTL)
    table.timestamp('expires_at').nullable();
    
    // Add index for efficient cleanup queries
    table.index(['status', 'expires_at'], 'idx_media_status_expires');
    table.index(['upload_session_id'], 'idx_media_upload_session');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.alterTable('media', function(table) {
    table.dropIndex(['status', 'expires_at'], 'idx_media_status_expires');
    table.dropIndex(['upload_session_id'], 'idx_media_upload_session');
    table.dropColumn('status');
    table.dropColumn('upload_session_id');
    table.dropColumn('expires_at');
  });
};
