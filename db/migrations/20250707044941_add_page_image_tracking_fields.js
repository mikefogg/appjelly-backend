/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  return knex.schema.alterTable('artifact_pages', function(table) {
    // Image generation tracking fields (similar to artifact table)
    table.decimal('image_generation_cost_usd', 10, 6).nullable().comment('Cost of DALL-E image generation in USD');
    table.decimal('image_generation_time_seconds', 10, 3).nullable().comment('Time taken for image generation in seconds');
    
    // AI model info
    table.string('image_ai_model').nullable().comment('AI model used for image generation (e.g. dall-e-3)');
    table.string('image_ai_provider').nullable().comment('AI provider (e.g. openai)');
    
    // Generation metadata
    table.timestamp('image_generated_at').nullable().comment('When image generation completed');
    table.text('image_prompt_used').nullable().comment('Full prompt used for image generation (for audit)');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  return knex.schema.alterTable('artifact_pages', function(table) {
    table.dropColumn('image_generation_cost_usd');
    table.dropColumn('image_generation_time_seconds');
    table.dropColumn('image_ai_model');
    table.dropColumn('image_ai_provider');
    table.dropColumn('image_generated_at');
    table.dropColumn('image_prompt_used');
  });
};