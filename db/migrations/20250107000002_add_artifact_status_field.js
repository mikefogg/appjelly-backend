export function up(knex) {
  return knex.schema.alterTable("artifacts", (table) => {
    // Add dedicated status field with proper constraints
    table.string("status").defaultTo("pending").notNull();
    
    // Add index for efficient filtering by status
    table.index("status", "idx_artifacts_status");
    
    // Add composite index for common queries (status + created_at)
    table.index(["status", "created_at"], "idx_artifacts_status_created");
  });
}

export function down(knex) {
  return knex.schema.alterTable("artifacts", (table) => {
    table.dropIndex("status", "idx_artifacts_status");
    table.dropIndex(["status", "created_at"], "idx_artifacts_status_created");
    table.dropColumn("status");
  });
}