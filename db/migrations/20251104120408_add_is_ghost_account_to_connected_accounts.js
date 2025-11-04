/**
 * Add is_ghost_account flag to connected_accounts
 * This marks the Ghost account's Twitter connection used for accessing private lists
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.table("connected_accounts", (table) => {
    table.boolean("is_ghost_account").defaultTo(false).notNullable();
    table.index("is_ghost_account", "connected_accounts_is_ghost_account_index");
  });

  // Add a unique constraint to ensure only one ghost account per platform
  await knex.raw(`
    CREATE UNIQUE INDEX connected_accounts_ghost_platform_unique
    ON connected_accounts (platform)
    WHERE is_ghost_account = true
  `);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS connected_accounts_ghost_platform_unique`);

  await knex.schema.table("connected_accounts", (table) => {
    table.dropIndex("is_ghost_account", "connected_accounts_is_ghost_account_index");
    table.dropColumn("is_ghost_account");
  });
}
