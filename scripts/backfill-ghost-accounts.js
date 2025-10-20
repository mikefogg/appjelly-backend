/**
 * Backfill Ghost Accounts
 * Creates default ghost accounts for all existing users who don't have one
 *
 * Usage: node scripts/backfill-ghost-accounts.js
 */

import Knex from "knex";
import connection from "#root/knexfile.js";
import { Model } from "objection";
import { Account, App, ConnectedAccount } from "#src/models/index.js";

const knexConnection = Knex(connection);
Model.knex(knexConnection);

async function backfillGhostAccounts() {
  console.log("🔄 Starting ghost account backfill...\n");

  try {
    // Get all accounts
    const accounts = await Account.query().select("id");
    console.log(`📊 Found ${accounts.length} total accounts`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const account of accounts) {
      try {
        // Get all apps for this account
        const apps = await App.query().select("id");

        for (const app of apps) {
          // Check if ghost account already exists
          const existingGhost = await ConnectedAccount.query()
            .where("account_id", account.id)
            .where("app_id", app.id)
            .where("platform", "ghost")
            .where("is_default", true)
            .first();

          if (existingGhost) {
            skipped++;
            console.log(`⏭️  Account ${account.id} / App ${app.id}: Ghost account already exists`);
            continue;
          }

          // Create ghost account
          await ConnectedAccount.findOrCreateGhostAccount(account.id, app.id);
          created++;
          console.log(`✅ Account ${account.id} / App ${app.id}: Created ghost account`);
        }
      } catch (error) {
        errors++;
        console.error(`❌ Account ${account.id}: Error - ${error.message}`);
      }
    }

    console.log("\n📈 Backfill Summary:");
    console.log(`   ✅ Created: ${created}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📊 Total: ${created + skipped + errors}`);

    if (errors === 0) {
      console.log("\n✨ Backfill completed successfully!");
    } else {
      console.log("\n⚠️  Backfill completed with errors. Please review the logs above.");
    }

  } catch (error) {
    console.error("\n💥 Fatal error during backfill:", error);
    process.exit(1);
  } finally {
    await knexConnection.destroy();
  }
}

// Run the backfill
backfillGhostAccounts()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
