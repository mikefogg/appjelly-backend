/**
 * Add content_preferences JSONB to connected_accounts
 * Consolidates: preserve_line_breaks, content_rotation_enabled + new settings
 *
 * content_preferences: {
 *   default_length: "short" | "medium" | "long",
 *   line_breaks: "minimal" | "moderate" | "frequent",
 *   emojis: "none" | "sparse" | "moderate" | "heavy",
 *   hashtags: "none" | "minimal" | "moderate",
 *   rotation_enabled: boolean
 * }
 */

// Platform defaults
const PLATFORM_DEFAULTS = {
  twitter: { default_length: "short", line_breaks: "moderate", emojis: "sparse", hashtags: "none", rotation_enabled: true },
  linkedin: { default_length: "medium", line_breaks: "moderate", emojis: "none", hashtags: "none", rotation_enabled: true },
  threads: { default_length: "short", line_breaks: "moderate", emojis: "sparse", hashtags: "none", rotation_enabled: true },
  facebook: { default_length: "short", line_breaks: "moderate", emojis: "sparse", hashtags: "none", rotation_enabled: true },
  ghost: { default_length: "short", line_breaks: "moderate", emojis: "sparse", hashtags: "none", rotation_enabled: true },
  custom: { default_length: "short", line_breaks: "moderate", emojis: "sparse", hashtags: "none", rotation_enabled: true },
};

export async function up(knex) {
  // Add content_preferences column
  await knex.schema.alterTable("connected_accounts", (table) => {
    table.jsonb("content_preferences").defaultTo("{}");
  });

  // Migrate existing data
  const accounts = await knex("connected_accounts").select(
    "id",
    "platform",
    "preserve_line_breaks",
    "content_rotation_enabled"
  );

  for (const account of accounts) {
    const platform = account.platform || "custom";
    const defaults = PLATFORM_DEFAULTS[platform] || PLATFORM_DEFAULTS.custom;

    const contentPreferences = {
      ...defaults,
      // Override with existing values
      line_breaks: account.preserve_line_breaks ? "frequent" : "moderate",
      rotation_enabled: account.content_rotation_enabled ?? true,
    };

    await knex("connected_accounts")
      .where("id", account.id)
      .update({ content_preferences: JSON.stringify(contentPreferences) });
  }

  // Drop old columns
  await knex.schema.alterTable("connected_accounts", (table) => {
    table.dropColumn("preserve_line_breaks");
    table.dropColumn("content_rotation_enabled");
  });
}

export async function down(knex) {
  // Add back old columns
  await knex.schema.alterTable("connected_accounts", (table) => {
    table.boolean("preserve_line_breaks").defaultTo(false);
    table.boolean("content_rotation_enabled").defaultTo(true);
  });

  // Migrate data back
  const accounts = await knex("connected_accounts").select("id", "content_preferences");

  for (const account of accounts) {
    const prefs = account.content_preferences || {};
    await knex("connected_accounts")
      .where("id", account.id)
      .update({
        preserve_line_breaks: prefs.line_breaks === "frequent",
        content_rotation_enabled: prefs.rotation_enabled ?? true,
      });
  }

  // Drop content_preferences
  await knex.schema.alterTable("connected_accounts", (table) => {
    table.dropColumn("content_preferences");
  });
}
