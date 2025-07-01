#!/usr/bin/env node

/**
 * Test account naming and display name generation
 * 
 * Usage:
 *   dev node tasks/test-account-naming.js
 */

import { Account, Actor, App } from "#src/models/index.js";

console.log("🧪 Testing account naming and display name generation...\n");

try {
  // Find the demo app
  const app = await App.query().findOne({ slug: "demo" });
  if (!app) {
    console.error("❌ Demo app not found");
    process.exit(1);
  }

  // Test 1: Create account with children but no account name
  console.log("📝 Test 1: Account with children but no account name");
  
  const testAccount1 = await Account.query().insert({
    clerk_id: `test_naming_${Date.now()}_1`,
    email: "test-naming-1@example.com",
    app_id: app.id,
    name: null, // No account name set
    metadata: {
      is_test_data: true,
      test_scenario: "account_naming"
    }
  });

  // Create some children (non-claimable)
  const children1 = await Actor.query().insert([
    {
      account_id: testAccount1.id,
      app_id: app.id,
      name: "Ava",
      type: "child",
      is_claimable: false,
      metadata: { is_test_data: true }
    },
    {
      account_id: testAccount1.id,
      app_id: app.id,
      name: "Ella",
      type: "child",
      is_claimable: false,
      metadata: { is_test_data: true }
    }
  ]);

  // Create a claimable child (should be ignored in display name)
  await Actor.query().insert({
    account_id: testAccount1.id,
    app_id: app.id,
    name: "Friend Kyle",
    type: "child",
    is_claimable: true, // Should be ignored
    metadata: { is_test_data: true }
  });

  const displayName1 = await testAccount1.generateDisplayName();
  console.log(`  ✅ Generated: "${displayName1}"`);
  console.log(`  📋 Expected: "Ava & Ella's Family" (should ignore claimable children)`);

  // Test 2: Account with account name set
  console.log("\n📝 Test 2: Account with account name");
  
  const testAccount2 = await Account.query().insert({
    clerk_id: `test_naming_${Date.now()}_2`,
    email: "test-naming-2@example.com",
    app_id: app.id,
    name: "Fogg", // Account name set
    metadata: {
      is_test_data: true,
      test_scenario: "account_naming"
    }
  });

  // Create children (should be ignored when account name is set)
  await Actor.query().insert({
    account_id: testAccount2.id,
    app_id: app.id,
    name: "Mason",
    type: "child",
    is_claimable: false,
    metadata: { is_test_data: true }
  });

  const displayName2 = await testAccount2.generateDisplayName();
  console.log(`  ✅ Generated: "${displayName2}"`);
  console.log(`  📋 Expected: "The Fogg Family" (should use account name, not children)`);

  // Test 3: Account with single child
  console.log("\n📝 Test 3: Account with single child");
  
  const testAccount3 = await Account.query().insert({
    clerk_id: `test_naming_${Date.now()}_3`,
    email: "test-naming-3@example.com",
    app_id: app.id,
    name: null,
    metadata: {
      is_test_data: true,
      test_scenario: "account_naming"
    }
  });

  await Actor.query().insert({
    account_id: testAccount3.id,
    app_id: app.id,
    name: "Sofia",
    type: "child",
    is_claimable: false,
    metadata: { is_test_data: true }
  });

  const displayName3 = await testAccount3.generateDisplayName();
  console.log(`  ✅ Generated: "${displayName3}"`);
  console.log(`  📋 Expected: "Sofia's Family"`);

  // Test 4: Account with three children
  console.log("\n📝 Test 4: Account with three children");
  
  const testAccount4 = await Account.query().insert({
    clerk_id: `test_naming_${Date.now()}_4`,
    email: "test-naming-4@example.com",
    app_id: app.id,
    name: null,
    metadata: {
      is_test_data: true,
      test_scenario: "account_naming"
    }
  });

  await Actor.query().insert([
    {
      account_id: testAccount4.id,
      app_id: app.id,
      name: "Emma",
      type: "child",
      is_claimable: false,
      metadata: { is_test_data: true }
    },
    {
      account_id: testAccount4.id,
      app_id: app.id,
      name: "Liam",
      type: "child", 
      is_claimable: false,
      metadata: { is_test_data: true }
    },
    {
      account_id: testAccount4.id,
      app_id: app.id,
      name: "Zoe",
      type: "child",
      is_claimable: false,
      metadata: { is_test_data: true }
    }
  ]);

  const displayName4 = await testAccount4.generateDisplayName();
  console.log(`  ✅ Generated: "${displayName4}"`);
  console.log(`  📋 Expected: "Emma, Liam & Zoe's Family"`);

  // Test 5: Account with no children
  console.log("\n📝 Test 5: Account with no children");
  
  const testAccount5 = await Account.query().insert({
    clerk_id: `test_naming_${Date.now()}_5`,
    email: "test-naming-5@example.com",
    app_id: app.id,
    name: null,
    metadata: {
      is_test_data: true,
      test_scenario: "account_naming"
    }
  });

  const displayName5 = await testAccount5.generateDisplayName();
  console.log(`  ✅ Generated: "${displayName5}"`);
  console.log(`  📋 Expected: "My Family"`);

  // Test 6: Update account name functionality
  console.log("\n📝 Test 6: Update account name");
  
  const updatedAccount = await testAccount1.updateAccountName("Smith");
  console.log(`  ✅ Updated account name to: "${updatedAccount.name}"`);
  console.log(`  ✅ New display name: "${updatedAccount.metadata.display_name}"`);
  console.log(`  📋 Expected: "The Smith Family"`);

  // Test 7: Remove account name (should fall back to children)
  console.log("\n📝 Test 7: Remove account name (fallback to children)");
  
  const revertedAccount = await updatedAccount.updateAccountName(null);
  console.log(`  ✅ Removed account name: ${revertedAccount.name}`);
  console.log(`  ✅ Fallback display name: "${revertedAccount.metadata.display_name}"`);
  console.log(`  📋 Expected: "Ava & Ella's Family" (back to children names)`);

  console.log("\n🎉 Account naming tests completed!");
  console.log("\n📋 Summary of naming rules:");
  console.log("  1. ✅ If account.name is set: 'The {name} Family'");
  console.log("  2. ✅ Otherwise, use non-claimable children:");
  console.log("     - 1 child: \"{child}'s Family\"");
  console.log("     - 2 children: \"{child1} & {child2}'s Family\"");
  console.log("     - 3+ children: \"{child1}, {child2} & {child3}'s Family\"");
  console.log("  3. ✅ Fallback if no children: 'My Family'");
  console.log("  4. ✅ Only non-claimable children count (actual family kids)");

  process.exit(0);
} catch (error) {
  console.error("❌ Error testing account naming:", error.message);
  process.exit(1);
}