#!/usr/bin/env node

/**
 * Test the account-links actors endpoints
 * 
 * Usage:
 *   dev node tasks/test-account-link-actors.js
 */

import { Account, Actor, AccountLink } from "#src/models/index.js";

console.log("🧪 Testing account-links actors filtering...\n");

try {
  // Find test families with claimed actors
  const accounts = await Account.query()
    .whereRaw("metadata->>'is_test_data' = ?", ['true'])
    .where("email", "like", "family%@testfamilies.com")
    .withGraphFetched("[actors]")
    .limit(3);

  if (accounts.length < 2) {
    console.error("❌ Need at least 2 test families. Run: dev node tasks/generate-test-families.js 2");
    process.exit(1);
  }

  console.log("👨‍👩‍👧‍👦 Test families found:");
  for (const account of accounts) {
    console.log(`  📧 ${account.email}: ${account.actors?.length || 0} actors`);
    if (account.actors?.length > 0) {
      for (const actor of account.actors) {
        console.log(`     - ${actor.name} (${actor.type}) - Claimable: ${actor.is_claimable}`);
      }
    }
  }

  // Check account links between families
  const links = await AccountLink.query()
    .whereIn("account_id", accounts.map(a => a.id))
    .where("status", "accepted")
    .withGraphFetched("[account, linked_account]");

  console.log(`\n🔗 Account links found: ${links.length}`);
  for (const link of links) {
    console.log(`  ${link.account?.email} ↔ ${link.linked_account?.email}`);
  }

  if (links.length === 0) {
    console.log("ℹ️  No family links found. This is expected if you haven't run claim tests yet.");
  }

  // Test Actor.findAccessibleActors for first family
  const testFamily = accounts[0];
  console.log(`\n🎯 Testing Actor.findAccessibleActors for: ${testFamily.email}`);
  
  const accessibleActors = await Actor.findAccessibleActors(testFamily.id, testFamily.app_id);
  
  console.log(`\n📊 Accessible actors for ${testFamily.email}:`);
  console.log(`  Total: ${accessibleActors.length}`);
  
  const ownedActors = accessibleActors.filter(a => a.account_id === testFamily.id);
  const linkedActors = accessibleActors.filter(a => a.account_id !== testFamily.id);
  
  console.log(`  Owned: ${ownedActors.length}`);
  console.log(`  Linked: ${linkedActors.length}`);
  
  if (ownedActors.length > 0) {
    console.log("\n  🏠 Owned actors:");
    for (const actor of ownedActors) {
      console.log(`     - ${actor.name} (${actor.type}) - Claimable: ${actor.is_claimable}`);
    }
  }
  
  if (linkedActors.length > 0) {
    console.log("\n  🔗 Linked actors (should all be is_claimable: false):");
    for (const actor of linkedActors) {
      const isValid = !actor.is_claimable;
      const status = isValid ? "✅" : "❌";
      console.log(`     ${status} ${actor.name} (${actor.type}) - Claimable: ${actor.is_claimable}`);
    }
    
    const invalidLinkedActors = linkedActors.filter(a => a.is_claimable);
    if (invalidLinkedActors.length > 0) {
      console.error(`\n❌ Found ${invalidLinkedActors.length} linked actors that are still claimable!`);
      console.error("   This violates the rule that only non-claimable actors should be accessible");
    } else {
      console.log("\n✅ All linked actors are correctly non-claimable (verified ownership)");
    }
  } else {
    console.log("\n  ℹ️  No linked actors found");
  }

  console.log("\n🎉 Account-links actors test completed!");
  
  process.exit(0);
} catch (error) {
  console.error("❌ Error testing account-links actors:", error.message);
  process.exit(1);
}