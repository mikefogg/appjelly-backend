export async function up(knex) {
  // Convert actor_ids from uuid[] to jsonb
  await knex.schema.alterTable("inputs", (table) => {
    table.dropColumn("actor_ids");
  });
  
  await knex.schema.alterTable("inputs", (table) => {
    table.jsonb("actor_ids").defaultTo("[]");
  });
}

export async function down(knex) {
  // Revert back to uuid[]
  await knex.schema.alterTable("inputs", (table) => {
    table.dropColumn("actor_ids");
  });
  
  await knex.schema.alterTable("inputs", (table) => {
    table.specificType("actor_ids", "uuid[]").defaultTo("{}");
  });
}