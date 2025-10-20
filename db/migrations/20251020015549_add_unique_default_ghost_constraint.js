/**
 * Add unique constraint to prevent duplicate default ghost accounts
 * Ensures only one default ghost account per (account_id, app_id)
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  // First, clean up any duplicate ghost accounts (keep the oldest one)
  await knex.raw(`
    DELETE FROM connected_accounts
    WHERE id IN (
      SELECT id FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY account_id, app_id, platform, is_default
            ORDER BY created_at ASC
          ) as row_num
        FROM connected_accounts
        WHERE platform = 'ghost' AND is_default = true
      ) t
      WHERE t.row_num > 1
    )
  `);

  // Add unique partial index to prevent future duplicates
  // This ensures only one default ghost account per (account_id, app_id)
  await knex.raw(`
    CREATE UNIQUE INDEX connected_accounts_unique_default_ghost
    ON connected_accounts (account_id, app_id)
    WHERE platform = 'ghost' AND is_default = true
  `);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS connected_accounts_unique_default_ghost
  `);
}
