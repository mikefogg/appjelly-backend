export function up(knex) {
  return knex.schema.alterTable('inputs', table => {
    table.enum('length', ['short', 'medium', 'long']).defaultTo('medium').notNullable();
    table.index('length'); // For filtering
  });
}

export function down(knex) {
  return knex.schema.alterTable('inputs', table => {
    table.dropColumn('length');
  });
}