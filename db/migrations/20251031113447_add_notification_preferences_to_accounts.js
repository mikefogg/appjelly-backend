/**
 * Add notification preferences to accounts table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.table("accounts", (table) => {
    // Whether user has enabled notifications
    table.boolean("notifications_enabled").defaultTo(false).notNullable();

    // OneSignal subscription ID (player_id) for sending push notifications
    table.string("onesignal_subscription_id", 255).nullable();

    // Track if we've shown the notification prompt to the user
    table.boolean("notification_prompt_shown").defaultTo(false).notNullable();

    // Index for looking up accounts by OneSignal subscription ID
    table.index("onesignal_subscription_id");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.table("accounts", (table) => {
    table.dropIndex("onesignal_subscription_id");
    table.dropColumn("notifications_enabled");
    table.dropColumn("onesignal_subscription_id");
    table.dropColumn("notification_prompt_shown");
  });
}
