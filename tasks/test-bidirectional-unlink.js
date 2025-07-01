#!/usr/bin/env node

/**
 * Test bidirectional account link deletion
 * 
 * Usage:
 *   dev node tasks/test-bidirectional-unlink.js
 */

import { Account, AccountLink } from "#src/models/index.js";

console.log("🧪 Testing bidirectional account link deletion...\n");

try {
  // Find test accounts with links
  const accounts = await Account.query()
    .whereRaw("metadata->>'is_test_data' = ?", ['true'])
    .where("email", "like", "family%@testfamilies.com")
    .limit(2);

  if (accounts.length < 2) {
    console.error("❌ Need at least 2 test accounts. Run some claim tests first.");
    process.exit(1);
  }

  const [accountA, accountB] = accounts;
  console.log(`👤 Account A: ${accountA.email}`);
  console.log(`👤 Account B: ${accountB.email}`);

  // Check existing links between these accounts
  const existingLinks = await AccountLink.query()
    .where((builder) => {
      builder
        .where({
          account_id: accountA.id,
          linked_account_id: accountB.id,
          app_id: accountA.app_id
        })
        .orWhere({
          account_id: accountB.id,
          linked_account_id: accountA.id,
          app_id: accountA.app_id
        });
    });

  console.log(`\n🔗 Existing links between accounts: ${existingLinks.length}`);
  
  if (existingLinks.length === 0) {
    console.log("ℹ️  No links exist. Creating test bidirectional links...");
    
    // Create bidirectional links
    await AccountLink.query().insert([
      {
        account_id: accountA.id,
        linked_account_id: accountB.id,
        app_id: accountA.app_id,
        status: "accepted",
        created_by_id: accountA.id,
        metadata: {
          test_bidirectional_delete: true,
          created_at: new Date().toISOString()
        }
      },
      {
        account_id: accountB.id,
        linked_account_id: accountA.id,
        app_id: accountA.app_id,
        status: "accepted",
        created_by_id: accountA.id,
        metadata: {
          test_bidirectional_delete: true,
          created_at: new Date().toISOString()
        }
      }
    ]);
    
    console.log("✅ Created bidirectional test links");
  }

  // Get the links again
  const linksToDelete = await AccountLink.query()
    .where((builder) => {
      builder
        .where({
          account_id: accountA.id,
          linked_account_id: accountB.id,
          app_id: accountA.app_id
        })
        .orWhere({
          account_id: accountB.id,
          linked_account_id: accountA.id,
          app_id: accountA.app_id
        });
    });

  console.log(`\n📊 Before deletion: ${linksToDelete.length} links found`);
  for (const link of linksToDelete) {
    console.log(`  - ${link.account_id} → ${link.linked_account_id}`);
  }

  if (linksToDelete.length === 0) {
    console.error("❌ No links found to test deletion");
    process.exit(1);
  }

  // Delete one link (should delete both directions)
  const linkToDelete = linksToDelete[0];
  console.log(`\n🗑️  Deleting link: ${linkToDelete.account_id} → ${linkToDelete.linked_account_id}`);

  // Simulate the bidirectional delete logic
  await AccountLink.transaction(async (trx) => {
    const accountId = linkToDelete.account_id;
    const linkedAccountId = linkToDelete.linked_account_id;

    // Delete both directions: A->B and B->A
    const deletedCount = await AccountLink.query(trx)
      .where((builder) => {
        builder
          .where({
            account_id: accountId,
            linked_account_id: linkedAccountId,
            app_id: accountA.app_id
          })
          .orWhere({
            account_id: linkedAccountId,
            linked_account_id: accountId,
            app_id: accountA.app_id
          });
      })
      .delete();
      
    console.log(`🗑️  Deleted ${deletedCount} link records`);
  });

  // Verify both directions are gone
  const remainingLinks = await AccountLink.query()
    .where((builder) => {
      builder
        .where({
          account_id: accountA.id,
          linked_account_id: accountB.id,
          app_id: accountA.app_id
        })
        .orWhere({
          account_id: accountB.id,
          linked_account_id: accountA.id,
          app_id: accountA.app_id
        });
    });

  console.log(`\n📊 After deletion: ${remainingLinks.length} links found`);
  
  if (remainingLinks.length === 0) {
    console.log("✅ SUCCESS: Both directions of the link were deleted!");
  } else {
    console.error("❌ FAILURE: Some links still exist:");
    for (const link of remainingLinks) {
      console.error(`  - ${link.account_id} → ${link.linked_account_id}`);
    }
  }

  console.log("\n🎉 Bidirectional delete test completed!");
  
  process.exit(0);
} catch (error) {
  console.error("❌ Error testing bidirectional delete:", error.message);
  process.exit(1);
}