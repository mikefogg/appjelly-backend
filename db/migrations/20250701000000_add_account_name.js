/**
 * Add optional name field to accounts for family names
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.alterTable('accounts', (table) => {
    table.string('name').nullable().comment('Optional family/account name (e.g. "Fogg")');
    
    table.index(['app_id', 'name'], 'accounts_app_id_name_index');
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.alterTable('accounts', (table) => {
    table.dropIndex(['app_id', 'name'], 'accounts_app_id_name_index');
    table.dropColumn('name');
  });
}