/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex.schema.alterTable('actors', function(table) {
    // Character continuity data from image analysis
    table.jsonb('character_continuity').nullable().comment('AI-analyzed character description for consistent image generation');
    
    // Avatar image key
    table.string('avatar_image_key').nullable().comment('Cloudflare image key for generated avatar');
    
    // Image generation tracking
    table.integer('analysis_tokens').nullable().comment('Tokens used for character image analysis');
    table.decimal('analysis_cost_usd', 10, 6).nullable().comment('Cost of character image analysis in USD');
    table.decimal('avatar_generation_cost_usd', 10, 6).nullable().comment('Cost of avatar generation in USD');
    
    // Processing status
    table.string('image_status').defaultTo('pending').comment('pending, analyzing, generating_avatar, completed, failed');
    table.timestamp('image_processed_at').nullable().comment('When image analysis and avatar generation completed');
    
    // Index for querying by image status
    table.index('image_status');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.alterTable('actors', function(table) {
    table.dropColumn('character_continuity');
    table.dropColumn('avatar_image_key');
    table.dropColumn('analysis_tokens');
    table.dropColumn('analysis_cost_usd');
    table.dropColumn('avatar_generation_cost_usd');
    table.dropColumn('image_status');
    table.dropColumn('image_processed_at');
  });
};