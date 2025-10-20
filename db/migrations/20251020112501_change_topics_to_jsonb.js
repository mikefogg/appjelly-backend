/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  // Change topics from text[] to jsonb in post_suggestions
  await knex.raw(`
    ALTER TABLE post_suggestions
    ALTER COLUMN topics TYPE jsonb USING to_jsonb(topics)
  `);

  // Change topics from text[] to jsonb in network_posts
  await knex.raw(`
    ALTER TABLE network_posts
    ALTER COLUMN topics TYPE jsonb USING to_jsonb(topics)
  `);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  // Revert topics from jsonb to text[] in post_suggestions
  await knex.raw(`
    ALTER TABLE post_suggestions
    ALTER COLUMN topics TYPE text[] USING ARRAY(SELECT jsonb_array_elements_text(topics))
  `);

  // Revert topics from jsonb to text[] in network_posts
  await knex.raw(`
    ALTER TABLE network_posts
    ALTER COLUMN topics TYPE text[] USING ARRAY(SELECT jsonb_array_elements_text(topics))
  `);
}
