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
    table.string("email");
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");
    table.string("name");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);

    table.unique(["clerk_id", "app_id"]);
    table.index(["app_id"]);
    table.index(["clerk_id"]);
  });

  // 3. Create subscriptions table
  await knex.schema.createTable("subscriptions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.string("rc_user_id").notNullable();
    table.string("rc_entitlement");
    table.string("rc_product_id");
    table.string("rc_period_type");
    table.string("rc_renewal_status");
    table.string("rc_platform");
    table.timestamp("rc_expiration");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);

    table.index(["account_id"]);
    table.index(["rc_user_id"]);
    table.index(["rc_renewal_status"]);
    table.index(["rc_expiration"]);
  });

  // 4. Create connected_accounts table (OAuth tokens for social networks)
  await knex.schema.createTable("connected_accounts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");

    // Platform
    table.string("platform").notNullable(); // 'twitter', 'threads', 'linkedin'
    table.string("platform_user_id").notNullable();
    table.string("username").notNullable();
    table.string("display_name");

    // OAuth
    table.text("access_token").notNullable();
    table.text("refresh_token");
    table.timestamp("token_expires_at");

    // Profile data
    table.jsonb("profile_data").defaultTo("{}");

    // Sync status
    table.timestamp("last_synced_at");
    table.timestamp("last_analyzed_at");
    table.string("sync_status").defaultTo("pending"); // 'pending', 'syncing', 'ready', 'error'

    // Settings
    table.boolean("is_active").defaultTo(true);
    table.jsonb("metadata").defaultTo("{}");

    table.timestamps(true, true);

    table.unique(["account_id", "platform", "platform_user_id"]);
    table.index(["account_id"]);
    table.index(["last_synced_at"]);
  });

  // 5. Create network_profiles table (who they follow)
  await knex.schema.createTable("network_profiles", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("connected_account_id").references("id").inTable("connected_accounts").onDelete("CASCADE");

    // Profile info
    table.string("platform").notNullable();
    table.string("platform_user_id").notNullable();
    table.string("username").notNullable();
    table.string("display_name");
    table.text("bio");

    // Stats
    table.integer("follower_count");
    table.integer("following_count");
    table.boolean("is_verified").defaultTo(false);

    // Metadata
    table.text("profile_image_url");
    table.jsonb("profile_data").defaultTo("{}");

    // Importance scoring
    table.decimal("engagement_score", 10, 2);
    table.decimal("relevance_score", 10, 2);

    table.timestamp("last_synced_at");
    table.timestamps(true, true);

    table.unique(["connected_account_id", "platform_user_id"]);
    table.index(["connected_account_id"]);
    table.index(["connected_account_id", "engagement_score"]);
  });

  // 6. Create network_posts table (posts from their network)
  await knex.schema.createTable("network_posts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("connected_account_id").references("id").inTable("connected_accounts").onDelete("CASCADE");
    table.uuid("network_profile_id").references("id").inTable("network_profiles").onDelete("CASCADE");

    // Post info
    table.string("platform").notNullable();
    table.string("post_id").notNullable();
    table.text("content").notNullable();
    table.timestamp("posted_at").notNullable();

    // Engagement
    table.integer("reply_count").defaultTo(0);
    table.integer("retweet_count").defaultTo(0);
    table.integer("like_count").defaultTo(0);
    table.integer("quote_count").defaultTo(0);
    table.decimal("engagement_score", 10, 2);

    // Analysis
    table.specificType("topics", "text[]");
    table.string("sentiment");

    table.jsonb("metadata").defaultTo("{}");
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.unique(["connected_account_id", "post_id"]);
    table.index(["connected_account_id", "posted_at"]);
    table.index(["connected_account_id", "engagement_score"]);
  });

  // 7. Create inputs table
  await knex.schema.createTable("inputs", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");
    table.uuid("connected_account_id").references("id").inTable("connected_accounts").onDelete("SET NULL");
    table.text("prompt");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);

    table.index(["account_id"]);
    table.index(["app_id"]);
    table.index(["created_at"]);
  });

  // 8. Create artifacts table (generated posts)
  await knex.schema.createTable("artifacts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("input_id").references("id").inTable("inputs").onDelete("CASCADE");
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");
    table.uuid("connected_account_id").references("id").inTable("connected_accounts").onDelete("SET NULL");

    table.string("artifact_type").notNullable(); // 'social_post'
    table.string("status").defaultTo("pending"); // 'pending', 'generating', 'completed', 'failed'
    table.string("title");
    table.text("content");

    // AI generation tracking
    table.integer("total_tokens");
    table.integer("prompt_tokens");
    table.integer("completion_tokens");
    table.decimal("cost_usd", 10, 6);
    table.decimal("generation_time_seconds", 10, 2);
    table.string("ai_model");
    table.string("ai_provider");

    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);

    table.index(["input_id"]);
    table.index(["account_id"]);
    table.index(["app_id"]);
    table.index(["artifact_type"]);
    table.index(["created_at"]);
  });

  // 9. Create media table (images for posts)
  await knex.schema.createTable("media", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("owner_type").notNullable(); // 'input', 'account', 'artifact'
    table.uuid("owner_id").notNullable();
    table.string("image_key");
    table.string("status").defaultTo("committed"); // 'pending', 'committed', 'expired'
    table.uuid("upload_session_id");
    table.timestamp("expires_at");
    table.jsonb("metadata").defaultTo("{}");
    table.timestamps(true, true);

    table.index(["owner_type", "owner_id"]);
    table.index(["image_key"]);
  });

  // 10. Create user_post_history table (published posts for style learning)
  await knex.schema.createTable("user_post_history", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("connected_account_id").references("id").inTable("connected_accounts").onDelete("CASCADE");
    table.uuid("artifact_id").references("id").inTable("artifacts").onDelete("SET NULL");

    // Post info
    table.string("platform").notNullable();
    table.string("post_id");
    table.text("content").notNullable();
    table.timestamp("posted_at").notNullable();

    // Engagement (can be updated later)
    table.integer("reply_count");
    table.integer("retweet_count");
    table.integer("like_count");
    table.decimal("engagement_score", 10, 2);

    // Analysis
    table.integer("character_count");
    table.boolean("has_emoji");
    table.boolean("has_hashtags");
    table.boolean("has_mentions");
    table.string("tone");

    table.jsonb("metadata").defaultTo("{}");
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.index(["connected_account_id", "posted_at"]);
  });

  // 11. Create post_suggestions table
  await knex.schema.createTable("post_suggestions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("account_id").references("id").inTable("accounts").onDelete("CASCADE");
    table.uuid("connected_account_id").references("id").inTable("connected_accounts").onDelete("CASCADE");
    table.uuid("app_id").references("id").inTable("apps").onDelete("CASCADE");

    // Suggestion
    table.string("suggestion_type").notNullable(); // 'original_post', 'reply', 'thread'
    table.text("content").notNullable();
    table.text("reasoning");

    // Source (if reply suggestion)
    table.uuid("source_post_id").references("id").inTable("network_posts").onDelete("SET NULL");
    table.jsonb("source_data").defaultTo("{}");

    // Status
    table.string("status").defaultTo("pending"); // 'pending', 'used', 'dismissed', 'expired'

    // Metadata
    table.specificType("topics", "text[]");
    table.integer("character_count");
    table.jsonb("metadata").defaultTo("{}");

    table.timestamp("expires_at");
    table.timestamps(true, true);

    table.index(["connected_account_id", "status", "expires_at"]);
    table.index(["account_id"]);
  });

  // 12. Create writing_styles table
  await knex.schema.createTable("writing_styles", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("connected_account_id").references("id").inTable("connected_accounts").onDelete("CASCADE");

    // Style analysis
    table.string("tone");
    table.integer("avg_length");
    table.decimal("emoji_frequency", 5, 2);
    table.decimal("hashtag_frequency", 5, 2);
    table.decimal("question_frequency", 5, 2);

    // Patterns
    table.specificType("common_phrases", "text[]");
    table.specificType("common_topics", "text[]");
    table.specificType("posting_times", "integer[]");

    // Raw style summary
    table.text("style_summary");

    // Metadata
    table.integer("sample_size");
    table.decimal("confidence_score", 5, 2);

    table.timestamp("analyzed_at").defaultTo(knex.fn.now());
    table.timestamps(true, true);

    table.unique(["connected_account_id"]);
  });

  // Add indexes for performance
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_accounts_app_clerk ON accounts(app_id, clerk_id)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_artifacts_account_created ON artifacts(account_id, created_at DESC)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_inputs_account_created ON inputs(account_id, created_at DESC)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_network_posts_topics ON network_posts USING GIN(topics)");
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_post_suggestions_active ON post_suggestions(connected_account_id) WHERE status = 'pending'");
}

export async function down(knex) {
  // Drop tables in reverse order
  await knex.schema.dropTableIfExists("writing_styles");
  await knex.schema.dropTableIfExists("post_suggestions");
  await knex.schema.dropTableIfExists("user_post_history");
  await knex.schema.dropTableIfExists("media");
  await knex.schema.dropTableIfExists("artifacts");
  await knex.schema.dropTableIfExists("inputs");
  await knex.schema.dropTableIfExists("network_posts");
  await knex.schema.dropTableIfExists("network_profiles");
  await knex.schema.dropTableIfExists("connected_accounts");
  await knex.schema.dropTableIfExists("subscriptions");
  await knex.schema.dropTableIfExists("accounts");
  await knex.schema.dropTableIfExists("apps");
}
