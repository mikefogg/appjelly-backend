#!/usr/bin/env node

/**
 * Show statistics about test vs real data
 * 
 * Usage:
 *   dev node tasks/show-test-stats.js
 */

import { Account, Actor, AccountLink } from "#src/models/index.js";

console.log("📊 Development Data Statistics\n");

try {
  const [totalAccounts, testAccounts, totalActors, testActors, totalLinks, testLinks] = await Promise.all([
    Account.query().resultSize(),
    Account.query().whereRaw("metadata->>'is_test_data' = ?", ['true']).resultSize(),
    Actor.query().resultSize(),
    Actor.query().whereRaw("metadata->>'is_test_data' = ?", ['true']).resultSize(),
    AccountLink.query().resultSize(),
    AccountLink.query().whereRaw("metadata->>'is_test_data' = ?", ['true']).resultSize(),
  ]);

  console.log("👥 Accounts:");
  console.log(`  Total: ${totalAccounts}`);
  console.log(`  Test:  ${testAccounts}`);
  console.log(`  Real:  ${totalAccounts - testAccounts}`);

  console.log("\n🎭 Actors:");
  console.log(`  Total: ${totalActors}`);
  console.log(`  Test:  ${testActors}`);
  console.log(`  Real:  ${totalActors - testActors}`);

  console.log("\n🔗 Account Links:");
  console.log(`  Total: ${totalLinks}`);
  console.log(`  Test:  ${testLinks}`);
  console.log(`  Real:  ${totalLinks - testLinks}`);

  // Show test account details if any exist
  if (testAccounts > 0) {
    console.log("\n🧪 Test Accounts:");
    const testAccountDetails = await Account.query()
      .whereRaw("metadata->>'is_test_data' = ?", ['true'])
      .withGraphFetched("[actors]");

    testAccountDetails.forEach(account => {
      console.log(`  📧 ${account.email}`);
      console.log(`     ${account.metadata?.display_name || 'No display name'}`);
      console.log(`     ${account.actors?.length || 0} actors`);
      if (account.actors?.length > 0) {
        account.actors.forEach(actor => {
          console.log(`       - ${actor.name} (${actor.type})`);
        });
      }
    });
  }

  console.log("\n🎯 Quick Commands:");
  console.log("  Generate test families: dev node tasks/generate-test-families.js [count]");
  console.log("  Clean up test data:     dev node tasks/cleanup-test-data.js");
  console.log("  Show stats:             dev node tasks/show-test-stats.js");

} catch (error) {
  console.error("❌ Failed to get statistics:", error);
  process.exit(1);
}