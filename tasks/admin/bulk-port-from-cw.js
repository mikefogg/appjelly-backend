/**
 * Bulk migrate Caption Writer users to Ghost where emails match
 *
 * Usage:
 *   node tasks/admin/bulk-port-from-cw.js [--dry-run]
 *
 * Examples:
 *   node tasks/admin/bulk-port-from-cw.js --dry-run
 *   node tasks/admin/bulk-port-from-cw.js
 */

import { App, knex } from "#src/models/index.js";
import { ghostQueue, JOB_MIGRATE_CW_CAPTIONS } from "#src/background/queues/index.js";

async function main() {
  try {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");

    console.log("=".repeat(60));
    console.log("Bulk Caption Writer -> Ghost Migration");
    console.log("=".repeat(60));
    console.log(`Dry run: ${dryRun}`);
    console.log("");

    // Find Ghost app
    const ghostApp = await App.query().where("slug", "ghost").first();

    if (!ghostApp) {
      console.error("Ghost app not found.");
      process.exit(1);
    }

    console.log(`Found Ghost app: id=${ghostApp.id}`);

    // Find all CW users with matching Ghost accounts who haven't been migrated
    const matchingUsers = await knex("cw_users as cw")
      .join("accounts as a", function () {
        this.on(knex.raw("LOWER(cw.email) = LOWER(a.email)")).andOn(
          "a.app_id",
          "=",
          knex.raw("?", [ghostApp.id])
        );
      })
      .whereNull("cw.ghost_account_id")
      .select(
        "cw.id as cw_user_id",
        "cw.email as cw_email",
        "a.id as ghost_account_id",
        "a.email as ghost_email"
      );

    console.log(`\nFound ${matchingUsers.length} CW users with matching Ghost accounts to migrate\n`);

    if (matchingUsers.length === 0) {
      console.log("Nothing to migrate. Done!");
      process.exit(0);
    }

    // Get caption counts for each user
    const cwUserIds = matchingUsers.map((u) => u.cw_user_id);
    const captionCounts = await knex("cw_captions")
      .whereIn("user_id", cwUserIds)
      .whereNull("migrated_at")
      .groupBy("user_id")
      .select("user_id")
      .count("id as count");

    const countMap = new Map(captionCounts.map((c) => [c.user_id, parseInt(c.count, 10)]));

    // Display summary
    console.log("Users to migrate:");
    console.log("-".repeat(60));

    let totalCaptions = 0;
    for (const user of matchingUsers) {
      const captionCount = countMap.get(user.cw_user_id) || 0;
      totalCaptions += captionCount;
      console.log(`  ${user.cw_email} -> ${user.ghost_email} (${captionCount} captions)`);
    }

    console.log("-".repeat(60));
    console.log(`Total: ${matchingUsers.length} users, ${totalCaptions} captions\n`);

    if (dryRun) {
      console.log("[DRY RUN] No changes made.");
      process.exit(0);
    }

    // Queue migration jobs
    console.log("Queuing migration jobs...\n");

    let queued = 0;
    let skipped = 0;

    for (const user of matchingUsers) {
      const captionCount = countMap.get(user.cw_user_id) || 0;

      if (captionCount === 0) {
        // Still link the accounts even if no captions to migrate
        await knex("cw_users").where("id", user.cw_user_id).update({
          ghost_account_id: user.ghost_account_id,
          migrated_at: new Date().toISOString(),
        });
        console.log(`  [LINKED] ${user.cw_email} (no captions to migrate)`);
        skipped++;
        continue;
      }

      const jobData = {
        cwUserId: user.cw_user_id,
        ghostAccountId: user.ghost_account_id,
        ghostAppId: ghostApp.id,
      };

      const job = await ghostQueue.add(JOB_MIGRATE_CW_CAPTIONS, jobData);

      // Update CW user with ghost account link
      await knex("cw_users").where("id", user.cw_user_id).update({
        ghost_account_id: user.ghost_account_id,
        migrated_at: new Date().toISOString(),
      });

      console.log(`  [QUEUED] ${user.cw_email} -> Job ID: ${job.id} (${captionCount} captions)`);
      queued++;
    }

    console.log("\n" + "=".repeat(60));
    console.log(`Migration jobs queued: ${queued}`);
    console.log(`Users linked (no captions): ${skipped}`);
    console.log("=".repeat(60));
    console.log("\nMonitor progress in the worker logs.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }

  process.exit(0);
}

main();
