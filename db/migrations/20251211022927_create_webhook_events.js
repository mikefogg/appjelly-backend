/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function up(knex) {
  return knex.schema.createTable("webhook_events", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");
    table.string("source", 50).notNullable().index(); // 'revenuecat', 'clerk', 'stripe', etc.
    table.string("event_type", 100).index(); // 'INITIAL_PURCHASE', 'RENEWAL', etc.
    table.string("event_id", 255).index(); // External event ID for deduplication
    table.jsonb("payload").notNullable(); // Raw webhook payload
    table.string("status", 20).defaultTo("received").index(); // 'received', 'processed', 'failed'
    table.text("error_message"); // Error details if processing failed
    table.integer("retry_count").defaultTo(0);
    table.timestamp("processed_at");
    table.timestamps(true, true);

    // Composite index for querying by source and status
    table.index(["source", "status"]);
    // Index for finding unprocessed events
    table.index(["status", "created_at"]);
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export function down(knex) {
  return knex.schema.dropTable("webhook_events");
}
