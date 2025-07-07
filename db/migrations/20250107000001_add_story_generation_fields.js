export function up(knex) {
  return knex.schema
    .alterTable("artifacts", (table) => {
      // Story metadata fields
      table.string("subtitle").nullable();
      table.text("description").nullable();
      
      // Token tracking fields for auditing
      table.integer("total_tokens").nullable();
      table.integer("plotline_tokens").nullable(); 
      table.integer("story_tokens").nullable();
      table.integer("plotline_prompt_tokens").nullable();
      table.integer("plotline_completion_tokens").nullable();
      table.integer("story_prompt_tokens").nullable();
      table.integer("story_completion_tokens").nullable();
      
      // Cost and performance tracking
      table.decimal("cost_usd", 10, 6).nullable(); // Up to $9999.999999
      table.decimal("generation_time_seconds", 8, 3).nullable(); // Up to 99999.999 seconds
      
      // Model info
      table.string("ai_model").nullable();
      table.string("ai_provider").nullable();
    })
    .alterTable("artifact_pages", (table) => {
      // Image generation fields
      table.text("image_prompt").nullable();
      table.string("image_status").defaultTo("pending").nullable(); // pending, generating, completed, failed
    });
}

export function down(knex) {
  return knex.schema
    .alterTable("artifacts", (table) => {
      table.dropColumn("subtitle");
      table.dropColumn("description");
      table.dropColumn("total_tokens");
      table.dropColumn("plotline_tokens");
      table.dropColumn("story_tokens");
      table.dropColumn("plotline_prompt_tokens");
      table.dropColumn("plotline_completion_tokens");
      table.dropColumn("story_prompt_tokens");
      table.dropColumn("story_completion_tokens");
      table.dropColumn("cost_usd");
      table.dropColumn("generation_time_seconds");
      table.dropColumn("ai_model");
      table.dropColumn("ai_provider");
    })
    .alterTable("artifact_pages", (table) => {
      table.dropColumn("image_prompt");
      table.dropColumn("image_status");
    });
}