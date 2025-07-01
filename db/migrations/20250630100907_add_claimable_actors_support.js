/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function up(knex) {
  return knex.schema
    // Add is_claimable field to actors table
    .alterTable('actors', (table) => {
      table.boolean('is_claimable').defaultTo(false).notNullable();
      table.index('is_claimable');
    })
    // Create artifact_actors junction table for tracking main characters
    .createTable('artifact_actors', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('artifact_id').notNullable().references('id').inTable('artifacts').onDelete('CASCADE');
      table.uuid('actor_id').notNullable().references('id').inTable('actors').onDelete('CASCADE');
      table.boolean('is_main_character').defaultTo(false).notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Indexes
      table.index(['artifact_id', 'actor_id']);
      table.index('is_main_character');
      table.unique(['artifact_id', 'actor_id']); // Each actor can only be in a story once
    });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function down(knex) {
  return knex.schema
    .dropTableIfExists('artifact_actors')
    .alterTable('actors', (table) => {
      table.dropColumn('is_claimable');
    });
}