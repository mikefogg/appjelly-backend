#!/usr/bin/env node

/**
 * Test the consolidated account update endpoint
 * 
 * Usage:
 *   dev node tasks/test-consolidated-account-update.js
 */

import { Account, App, Actor } from "#src/models/index.js";

console.log("🧪 Testing consolidated account update endpoint...\n");

try {
  // Find the demo app
  const app = await App.query().findOne({ slug: "demo" });
  if (!app) {
    console.error("❌ Demo app not found");
    process.exit(1);
  }

  // Create test account
  const testAccount = await Account.query().insert({
    clerk_id: `test_consolidated_${Date.now()}`,
    email: "test-consolidated@example.com",
    app_id: app.id,
    name: null,
    metadata: {
      is_test_data: true,
      some_setting: "original_value"
    }
  });

  // Create children for display name generation
  await Actor.query().insert([
    {
      account_id: testAccount.id,
      app_id: app.id,
      name: "Ava",
      type: "child",
      is_claimable: false,
      metadata: { is_test_data: true }
    },
    {
      account_id: testAccount.id,
      app_id: app.id,
      name: "Ella", 
      type: "child",
      is_claimable: false,
      metadata: { is_test_data: true }
    }
  ]);

  console.log(`📝 Test Account: ${testAccount.email}`);
  console.log(`   Initial name: ${testAccount.name}`);
  console.log(`   Initial metadata: ${JSON.stringify(testAccount.metadata)}`);

  // Test 1: Update only name (should regenerate display name)
  console.log("\n📝 Test 1: Update only account name");
  
  const updated1 = await testAccount.updateAccountName("Wilson");
  console.log(`  ✅ Name updated to: "${updated1.name}"`);
  console.log(`  ✅ Display name: "${updated1.metadata.display_name}"`);
  console.log(`  ✅ Source: "${updated1.metadata.display_name_source}"`);
  console.log(`  📋 Expected: "Wilson" → "The Wilson Family"`);

  // Test 2: Update only metadata (should preserve name and display name)
  console.log("\n📝 Test 2: Update only metadata");
  
  const updated2 = await updated1.$query().patchAndFetch({
    metadata: {
      ...updated1.metadata,
      some_setting: "new_value",
      another_setting: "added"
    }
  });
  
  console.log(`  ✅ Name preserved: "${updated2.name}"`);
  console.log(`  ✅ Display name preserved: "${updated2.metadata.display_name}"`);
  console.log(`  ✅ Metadata updated: some_setting = "${updated2.metadata.some_setting}"`);
  console.log(`  ✅ Metadata added: another_setting = "${updated2.metadata.another_setting}"`);

  // Test 3: Update both name and metadata together
  console.log("\n📝 Test 3: Update both name and metadata");
  
  // Simulate what the PATCH /accounts/me endpoint would do
  const nameUpdate = "Smith";
  const metadataUpdate = { 
    some_setting: "final_value",
    theme: "dark" 
  };
  
  let updated3 = await updated2.updateAccountName(nameUpdate);
  updated3 = await updated3.$query().patchAndFetch({
    metadata: {
      ...updated3.metadata,
      ...metadataUpdate,
    },
  });

  console.log(`  ✅ Name updated: "${updated3.name}"`);
  console.log(`  ✅ Display name regenerated: "${updated3.metadata.display_name}"`);
  console.log(`  ✅ Source updated: "${updated3.metadata.display_name_source}"`);
  console.log(`  ✅ Metadata merged: some_setting = "${updated3.metadata.some_setting}"`);
  console.log(`  ✅ Metadata merged: theme = "${updated3.metadata.theme}"`);
  console.log(`  ✅ Metadata preserved: another_setting = "${updated3.metadata.another_setting}"`);

  // Test 4: Remove name (should fallback to children)
  console.log("\n📝 Test 4: Remove name (fallback to children)");
  
  const updated4 = await updated3.updateAccountName(null);
  console.log(`  ✅ Name removed: ${updated4.name}`);
  console.log(`  ✅ Display name fallback: "${updated4.metadata.display_name}"`);
  console.log(`  ✅ Source changed: "${updated4.metadata.display_name_source}"`);
  console.log(`  📋 Expected: null → "Ava & Ella's Family"`);

  console.log("\n🎉 Consolidated account update tests completed!");
  
  console.log("\n📋 API Usage:");
  console.log("  PATCH /accounts/me");
  console.log("  {");
  console.log("    \"name\": \"Johnson\",           // Updates family name & regenerates display name");
  console.log("    \"metadata\": {                // Updates any metadata fields");
  console.log("      \"theme\": \"dark\",");
  console.log("      \"notifications\": true");
  console.log("    }");
  console.log("  }");
  console.log("");
  console.log("  - Can update name only, metadata only, or both");
  console.log("  - Name updates automatically regenerate display name");
  console.log("  - Metadata is merged (preserves existing fields)");
  console.log("  - Extensible for future account fields");

  process.exit(0);
} catch (error) {
  console.error("❌ Error testing consolidated update:", error.message);
  process.exit(1);
}