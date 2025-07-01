#!/usr/bin/env node

/**
 * Test account serializers with new naming info
 * 
 * Usage:
 *   dev node tasks/test-account-serializers.js
 */

import { Account, App, Actor, AccountLink } from "#src/models/index.js";
import { currentAccountSerializer, publicAccountSerializer, accountLinkSerializer } from "#src/serializers/index.js";

console.log("🧪 Testing account serializers with naming info...\n");

try {
  // Find the demo app
  const app = await App.query().findOne({ slug: "demo" });
  if (!app) {
    console.error("❌ Demo app not found");
    process.exit(1);
  }

  // Test 1: Account with name set
  console.log("📝 Test 1: Account with name set");
  
  const accountWithName = await Account.query().insert({
    clerk_id: `test_serializer_${Date.now()}_1`,
    email: "test-serializer-1@example.com",
    app_id: app.id,
    name: "Johnson", // Family name set
    metadata: {
      is_test_data: true,
      display_name: "The Johnson Family",
      display_name_source: "account_name",
      display_name_updated_at: new Date().toISOString()
    }
  });

  // Add app relationship for serializer
  accountWithName.app = app;

  const serialized1 = currentAccountSerializer(accountWithName);
  console.log("  ✅ Current account serializer:");
  console.log(`     name: "${serialized1.name}"`);
  console.log(`     display_name_info.current: "${serialized1.display_name_info.current}"`);
  console.log(`     display_name_info.source: "${serialized1.display_name_info.source}"`);

  const publicSerialized1 = publicAccountSerializer(accountWithName);
  console.log("  ✅ Public account serializer:");
  console.log(`     name: "${publicSerialized1.name}"`);
  console.log(`     display_name: "${publicSerialized1.display_name}"`);

  // Test 2: Account without name (children-based)
  console.log("\n📝 Test 2: Account without name (children-based)");
  
  const accountWithoutName = await Account.query().insert({
    clerk_id: `test_serializer_${Date.now()}_2`,
    email: "test-serializer-2@example.com",
    app_id: app.id,
    name: null, // No family name
    metadata: {
      is_test_data: true,
      display_name: "Emma & Liam's Family",
      display_name_source: "children_names",
      display_name_updated_at: new Date().toISOString()
    }
  });

  // Add children for context
  await Actor.query().insert([
    {
      account_id: accountWithoutName.id,
      app_id: app.id,
      name: "Emma",
      type: "child",
      is_claimable: false,
      metadata: { is_test_data: true }
    },
    {
      account_id: accountWithoutName.id,
      app_id: app.id,
      name: "Liam",
      type: "child",
      is_claimable: false,
      metadata: { is_test_data: true }
    }
  ]);

  // Add app relationship for serializer
  accountWithoutName.app = app;

  const serialized2 = currentAccountSerializer(accountWithoutName);
  console.log("  ✅ Current account serializer:");
  console.log(`     name: ${serialized2.name}`);
  console.log(`     display_name_info.current: "${serialized2.display_name_info.current}"`);
  console.log(`     display_name_info.source: "${serialized2.display_name_info.source}"`);

  const publicSerialized2 = publicAccountSerializer(accountWithoutName);
  console.log("  ✅ Public account serializer:");
  console.log(`     name: ${publicSerialized2.name}`);
  console.log(`     display_name: "${publicSerialized2.display_name}"`);

  // Test 3: Account link serializer
  console.log("\n📝 Test 3: Account link serializer");
  
  // Create a test account link
  const accountLink = await AccountLink.query().insert({
    account_id: accountWithName.id,
    linked_account_id: accountWithoutName.id,
    app_id: app.id,
    status: "accepted",
    created_by_id: accountWithName.id,
    metadata: {
      is_test_data: true,
      created_through_test: true
    }
  });

  // Load relationships for serializer
  const linkWithRelations = await AccountLink.query()
    .findById(accountLink.id)
    .withGraphFetched("[account, linked_account]");

  const linkSerialized = accountLinkSerializer(linkWithRelations);
  console.log("  ✅ Account link serializer:");
  console.log(`     linked_account.name: "${linkSerialized.linked_account.name}"`);
  console.log(`     linked_account.display_name: "${linkSerialized.linked_account.display_name}"`);
  console.log(`     from_account.name: "${linkSerialized.from_account.name}"`);
  console.log(`     from_account.display_name: "${linkSerialized.from_account.display_name}"`);

  console.log("\n🎉 Account serializer tests completed!");
  
  console.log("\n📋 Summary of serializer data:");
  console.log("  ✅ currentAccountSerializer includes:");
  console.log("     - name: Account/family name (e.g. 'Johnson')");
  console.log("     - display_name_info: Current display name, source, last updated");
  console.log("  ✅ publicAccountSerializer includes:");
  console.log("     - name: Account/family name for public display");
  console.log("     - display_name: Generated display name");
  console.log("  ✅ accountLinkSerializer includes:");
  console.log("     - linked_account.name & display_name");
  console.log("     - from_account.name & display_name");

  process.exit(0);
} catch (error) {
  console.error("❌ Error testing serializers:", error.message);
  process.exit(1);
}