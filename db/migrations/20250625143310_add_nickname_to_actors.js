export function up(knex) {
  return knex.schema.alterTable('actors', table => {
    table.string('nickname').nullable().comment('Private nickname for disambiguation, never shared');
    table.index('nickname'); // For searching
  });
}

export function down(knex) {
  return knex.schema.alterTable('actors', table => {
    table.dropColumn('nickname');
  });
}