export async function up(knex) {
  // 1. Create apps table
  await knex.schema.createTable("apps", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("slug").unique().notNullable();
    table.string("name").notNullable();
    table.jsonb("config").defaultTo("{}");
    table.timestamps(true, true);
  });

  // 2. Create accounts table
  await knex.schema.createTable("accounts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("clerk_id").notNullable();
    table.string("email").notNullable();
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);
    
    table.unique(["clerk_id", "app_id"]);
    table.index(["app_id"]);
    table.index(["clerk_id"]);
  });

  // 3. Create account_links table
  await knex.schema.createTable("account_links", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.uuid("linked_account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");
    table.string("status").notNullable().defaultTo("pending"); // pending, accepted, revoked
    table.uuid("created_by_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);
    
    table.unique(["account_id", "linked_account_id", "app_id"]);
    table.index(["account_id"]);
    table.index(["linked_account_id"]);
    table.index(["app_id"]);
    table.index(["status"]);
  });

  // 4. Create actors table
  await knex.schema.createTable("actors", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");
    table.string("name").notNullable();
    table.string("type").notNullable(); // child, pet, adult, character, etc.
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);
    
    table.index(["account_id"]);
    table.index(["app_id"]);
    table.index(["type"]);
  });

  // 5. Create media table
  await knex.schema.createTable("media", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("owner_type").notNullable(); // actor, input
    table.uuid("owner_id").notNullable();
    table.string("image_key").notNullable();
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);
    
    table.index(["owner_type", "owner_id"]);
    table.index(["image_key"]);
  });

  // 6. Create inputs table
  await knex.schema.createTable("inputs", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");
    table.text("prompt").notNullable();
    table.specificType("actor_ids", "uuid[]").defaultTo("{}");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);
    
    table.index(["account_id"]);
    table.index(["app_id"]);
    table.index(["created_at"]);
  });

  // 7. Create artifacts table
  await knex.schema.createTable("artifacts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("input_id").references("id").inTable("inputs").onDelete("CASCADE");
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");
    table.string("artifact_type").notNullable(); // story, image, video, etc.
    table.string("title");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);
    
    table.index(["input_id"]);
    table.index(["account_id"]);
    table.index(["app_id"]);
    table.index(["artifact_type"]);
    table.index(["created_at"]);
  });

  // 8. Create artifact_pages table
  await knex.schema.createTable("artifact_pages", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("artifact_id").references("id").inTable("artifacts").onDelete("CASCADE");
    table.integer("page_number").notNullable();
    table.text("text");
    table.string("image_key");
    table.jsonb("layout_data").defaultTo("{}");
    table.timestamps(true, true);
    
    table.unique(["artifact_id", "page_number"]);
    table.index(["artifact_id"]);
    table.index(["page_number"]);
  });

  // 9. Create shared_views table
  await knex.schema.createTable("shared_views", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("artifact_id").references("id").inTable("artifacts").onDelete("CASCADE");
    table.string("token").unique().notNullable();
    table.jsonb("permissions").defaultTo("{}");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);
    
    table.index(["artifact_id"]);
    table.index(["token"]);
  });

  // 10. Create subscriptions table
  await knex.schema.createTable("subscriptions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.string("rc_user_id").notNullable();
    table.string("rc_entitlement");
    table.string("rc_product_id");
    table.string("rc_period_type"); // normal, trial, intro
    table.string("rc_renewal_status"); // active, expired, billing_issue, etc.
    table.string("rc_platform"); // ios, android, web
    table.timestamp("rc_expiration");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);
    
    table.index(["account_id"]);
    table.index(["rc_user_id"]);
    table.index(["rc_renewal_status"]);
    table.index(["rc_expiration"]);
  });

  // Add indexes for performance
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_accounts_app_clerk ON accounts(app_id, clerk_id)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_artifacts_account_created ON artifacts(account_id, created_at DESC)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_inputs_account_created ON inputs(account_id, created_at DESC)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_actors_account_type ON actors(account_id, type)");
}

export async function down(knex) {
  // Drop tables in reverse order due to foreign key constraints
  await knex.schema.dropTableIfExists("subscriptions");
  await knex.schema.dropTableIfExists("shared_views");
  await knex.schema.dropTableIfExists("artifact_pages");
  await knex.schema.dropTableIfExists("artifacts");
  await knex.schema.dropTableIfExists("inputs");
  await knex.schema.dropTableIfExists("media");
  await knex.schema.dropTableIfExists("actors");
  await knex.schema.dropTableIfExists("account_links");
  await knex.schema.dropTableIfExists("accounts");
  await knex.schema.dropTableIfExists("apps");
}