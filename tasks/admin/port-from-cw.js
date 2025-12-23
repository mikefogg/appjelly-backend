/**
 * Port Caption Writer captions to Ghost as draft artifacts
 *
 * Usage:
 *   node tasks/admin/port-from-cw.js --from=<cw_email> --to=<ghost_email> [--dry-run] [--connected-account-id=<uuid>] [--account-id=<uuid>]
 *
 * Examples:
 *   node tasks/admin/port-from-cw.js --from=user@example.com --to=user@example.com --dry-run
 *   node tasks/admin/port-from-cw.js --from=user@example.com --to=user@example.com
 *   node tasks/admin/port-from-cw.js --from=user@example.com --to=user@example.com --connected-account-id=abc123
 *   node tasks/admin/port-from-cw.js --from=user@example.com --to=user@example.com --account-id=<uuid> --connected-account-id=abc123
 */

import { Account, App, ConnectedAccount, knex } from "#src/models/index.js";
import { ghostQueue, JOB_MIGRATE_CW_CAPTIONS } from "#src/background/queues/index.js";

async function main() {
  try {
    const args = process.argv.slice(2);

    // Parse arguments
    const fromArg = args.find((arg) => arg.startsWith("--from="));
    const toArg = args.find((arg) => arg.startsWith("--to="));
    const accountIdArg = args.find((arg) => arg.startsWith("--account-id="));
    const connectedAccountArg = args.find((arg) => arg.startsWith("--connected-account-id="));
    const dryRun = args.includes("--dry-run");

    const fromEmail = fromArg?.split("=")[1];
    const toEmail = toArg?.split("=")[1];
    const forceAccountId = accountIdArg?.split("=")[1];
    const forceConnectedAccountId = connectedAccountArg?.split("=")[1];

    if (!fromEmail || !toEmail) {
      console.error(
        "Usage: node tasks/admin/port-from-cw.js --from=<cw_email> --to=<ghost_email> [--dry-run] [--account-id=<uuid>] [--connected-account-id=<uuid>]"
      );
      process.exit(1);
    }

    console.log("=".repeat(60));
    console.log("Caption Writer -> Ghost Migration");
    console.log("=".repeat(60));
    console.log(`From CW email: ${fromEmail}`);
    console.log(`To Ghost email: ${toEmail}`);
    if (forceAccountId) {
      console.log(`Force account ID: ${forceAccountId}`);
    }
    if (forceConnectedAccountId) {
      console.log(`Force connected account: ${forceConnectedAccountId}`);
    }
    console.log(`Dry run: ${dryRun}`);
    console.log("");

    // Find CW user
    const cwUser = await knex("cw_users").whereRaw("LOWER(email) = LOWER(?)", [fromEmail]).first();

    if (!cwUser) {
      console.error(`CW user not found with email: ${fromEmail}`);
      process.exit(1);
    }

    console.log(`Found CW user: id=${cwUser.id}, email=${cwUser.email}`);

    // Find Ghost app
    const ghostApp = await App.query().where("slug", "ghost").first();

    if (!ghostApp) {
      console.error("Ghost app not found.");
      process.exit(1);
    }

    console.log(`Found Ghost app: id=${ghostApp.id}`);

    // Find Ghost account
    let ghostAccount;
    if (forceAccountId) {
      ghostAccount = await Account.query().findById(forceAccountId);
      if (!ghostAccount) {
        console.error(`Account not found with ID: ${forceAccountId}`);
        process.exit(1);
      }
    } else {
      ghostAccount = await Account.query()
        .whereRaw("LOWER(email) = LOWER(?)", [toEmail])
        .where("app_id", ghostApp.id)
        .first();
      if (!ghostAccount) {
        console.error(`Ghost account not found with email: ${toEmail}`);
        process.exit(1);
      }
    }

    console.log(`Found Ghost account: id=${ghostAccount.id}, email=${ghostAccount.email}`);

    // Validate connected account if provided
    if (forceConnectedAccountId) {
      const connection = await ConnectedAccount.query()
        .findById(forceConnectedAccountId)
        .where("account_id", ghostAccount.id)
        .where("app_id", ghostApp.id);

      if (!connection) {
        console.error(
          `Connected account ${forceConnectedAccountId} not found or doesn't belong to this account.`
        );
        process.exit(1);
      }

      console.log(`Validated connected account: ${connection.id} (${connection.platform})`);
    }

    // Count captions to migrate
    const countResult = await knex("cw_captions")
      .where("user_id", cwUser.id)
      .whereNull("migrated_at")
      .count("id as count")
      .first();

    const unmigratedCount = parseInt(countResult.count, 10);

    console.log(`\nCaptions to migrate: ${unmigratedCount}`);

    // Show already migrated count
    const migratedResult = await knex("cw_captions")
      .where("user_id", cwUser.id)
      .whereNotNull("migrated_at")
      .count("id as count")
      .first();

    const migratedCount = parseInt(migratedResult.count, 10);
    if (migratedCount > 0) {
      console.log(`Already migrated: ${migratedCount}`);
    }

    // Show error count
    const errorResult = await knex("cw_captions")
      .where("user_id", cwUser.id)
      .whereNotNull("migration_error")
      .count("id as count")
      .first();

    const errorCount = parseInt(errorResult.count, 10);
    if (errorCount > 0) {
      console.log(`Previous errors: ${errorCount}`);
    }

    if (unmigratedCount === 0) {
      console.log("\nNo captions to migrate. Done!");
      process.exit(0);
    }

    if (dryRun) {
      console.log("\n[DRY RUN] Would queue migration job with:");
      console.log(`  cwUserId: ${cwUser.id}`);
      console.log(`  ghostAccountId: ${ghostAccount.id}`);
      console.log(`  ghostAppId: ${ghostApp.id}`);
      if (forceConnectedAccountId) {
        console.log(`  forceConnectedAccountId: ${forceConnectedAccountId}`);
      }
      console.log("\n[DRY RUN] No changes made.");
    } else {
      console.log("\nQueuing migration job...");

      const jobData = {
        cwUserId: cwUser.id,
        ghostAccountId: ghostAccount.id,
        ghostAppId: ghostApp.id,
      };

      if (forceConnectedAccountId) {
        jobData.forceConnectedAccountId = forceConnectedAccountId;
      }

      const job = await ghostQueue.add(JOB_MIGRATE_CW_CAPTIONS, jobData);

      // Update CW user with ghost account link
      await knex("cw_users").where("id", cwUser.id).update({
        ghost_account_id: ghostAccount.id,
        migrated_at: new Date().toISOString(),
      });

      console.log(`\nMigration job queued successfully!`);
      console.log(`Job ID: ${job.id}`);
      console.log(`\nMonitor progress in the worker logs.`);
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }

  process.exit(0);
}

main();
