/**
 * Extract OAuth credentials to separate connected_account_auth table
 * This allows accounts to exist without OAuth (manual accounts)
 * and makes platform editable when not connected
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  // 1. Create connected_account_auth table
  await knex.schema.createTable('connected_account_auth', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('access_token').notNullable();
    table.text('refresh_token');
    table.timestamp('token_expires_at');
    table.jsonb('metadata').defaultTo('{}'); // Store platform_user_id, username, profile data, etc.
    table.timestamps(true, true);
  });

  // 2. Migrate OAuth data from connected_accounts to connected_account_auth
  // Only for accounts that have access_token (skip ghost platform and any without tokens)
  const oauthAccounts = await knex('connected_accounts')
    .whereNotNull('access_token')
    .select('id', 'access_token', 'refresh_token', 'token_expires_at',
            'platform_user_id', 'username', 'profile_data', 'created_at');

  for (const account of oauthAccounts) {
    await knex('connected_account_auth').insert({
      id: knex.raw('gen_random_uuid()'),
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      token_expires_at: account.token_expires_at,
      metadata: {
        platform_user_id: account.platform_user_id,
        username: account.username,
        profile_data: account.profile_data || {},
      },
      created_at: account.created_at,
      updated_at: account.created_at,
    });
  }

  // 3. Add new columns to connected_accounts
  await knex.schema.table('connected_accounts', (table) => {
    table.string('label', 255); // User-facing friendly name
    table.uuid('connected_account_auth_id').references('id').inTable('connected_account_auth').onDelete('SET NULL');
  });

  // 4. Link connected_accounts to their auth records
  const authRecords = await knex('connected_account_auth').select('id', 'metadata');

  for (const auth of authRecords) {
    const metadata = auth.metadata || {};
    if (metadata.username) {
      // Find the account that matches this username
      await knex('connected_accounts')
        .where('username', metadata.username)
        .whereNotNull('access_token')
        .update({
          connected_account_auth_id: auth.id,
        });
    }
  }

  // 5. Set label for all accounts (COALESCE display_name or username)
  await knex.raw(`
    UPDATE connected_accounts
    SET label = COALESCE(display_name, username, 'My ' || platform || ' Account')
    WHERE label IS NULL
  `);

  // 6. Make username nullable (manual accounts may not have one)
  await knex.schema.table('connected_accounts', (table) => {
    table.string('username', 255).nullable().alter();
  });

  // 7. Make platform nullable/default to 'custom' (for undecided accounts)
  await knex.schema.table('connected_accounts', (table) => {
    table.string('platform', 255).nullable().alter();
  });

  // 8. Drop OAuth columns from connected_accounts (now in auth table)
  await knex.schema.table('connected_accounts', (table) => {
    table.dropColumn('access_token');
    table.dropColumn('refresh_token');
    table.dropColumn('token_expires_at');
    table.dropColumn('platform_user_id');
    // Keep profile_data for now as it might have non-OAuth data
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  // 1. Re-add OAuth columns to connected_accounts
  await knex.schema.table('connected_accounts', (table) => {
    table.text('access_token');
    table.text('refresh_token');
    table.timestamp('token_expires_at');
    table.string('platform_user_id', 255);
  });

  // 2. Restore OAuth data from auth table
  const accountsWithAuth = await knex('connected_accounts')
    .whereNotNull('connected_account_auth_id')
    .select('id', 'connected_account_auth_id');

  for (const account of accountsWithAuth) {
    const auth = await knex('connected_account_auth')
      .where('id', account.connected_account_auth_id)
      .first();

    if (auth) {
      await knex('connected_accounts')
        .where('id', account.id)
        .update({
          access_token: auth.access_token,
          refresh_token: auth.refresh_token,
          token_expires_at: auth.token_expires_at,
          platform_user_id: auth.metadata?.platform_user_id,
        });
    }
  }

  // 3. Make platform NOT NULL again
  await knex.schema.table('connected_accounts', (table) => {
    table.string('platform', 255).notNullable().alter();
  });

  // 4. Make username NOT NULL again
  await knex.schema.table('connected_accounts', (table) => {
    table.string('username', 255).notNullable().alter();
  });

  // 5. Drop new columns
  await knex.schema.table('connected_accounts', (table) => {
    table.dropColumn('connected_account_auth_id');
    table.dropColumn('label');
  });

  // 6. Drop auth table
  await knex.schema.dropTable('connected_account_auth');
};
