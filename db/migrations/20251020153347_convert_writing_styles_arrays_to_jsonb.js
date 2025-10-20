/**
 * Convert writing_styles array columns to JSONB
 * This fixes the malformed array literal errors by using JSONB which accepts JavaScript arrays directly
 */

export async function up(knex) {
  await knex.schema.alterTable('writing_styles', (table) => {
    // Drop the old text[] and integer[] columns
    table.dropColumn('common_phrases');
    table.dropColumn('common_topics');
    table.dropColumn('posting_times');
  });

  await knex.schema.alterTable('writing_styles', (table) => {
    // Add them back as JSONB
    table.jsonb('common_phrases').nullable();
    table.jsonb('common_topics').nullable();
    table.jsonb('posting_times').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('writing_styles', (table) => {
    table.dropColumn('common_phrases');
    table.dropColumn('common_topics');
    table.dropColumn('posting_times');
  });

  await knex.schema.alterTable('writing_styles', (table) => {
    table.specificType('common_phrases', 'text[]').nullable();
    table.specificType('common_topics', 'text[]').nullable();
    table.specificType('posting_times', 'integer[]').nullable();
  });
}
