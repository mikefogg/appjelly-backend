/**
 * Add timezone and generation time fields to accounts table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.table("accounts", (table) => {
    // IANA timezone (e.g., "America/New_York")
    table.string("timezone", 100).nullable();

    // Hour in user's local timezone (0-23)
    table.integer("generation_time").defaultTo(7).notNullable();

    // Pre-calculated hour in UTC (0-23) for efficient querying
    table.integer("generation_time_utc").nullable();

    // Index for fast lookups during hourly scheduler
    table.index("generation_time_utc");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.table("accounts", (table) => {
    table.dropIndex("generation_time_utc");
    table.dropColumn("timezone");
    table.dropColumn("generation_time");
    table.dropColumn("generation_time_utc");
  });
}
