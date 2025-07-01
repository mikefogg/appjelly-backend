#!/usr/bin/env node

/**
 * Create a share link for a test family's most recent story
 * 
 * Usage:
 *   dev node tasks/create-share-link.js [family_number] [app_slug]
 * 
 * Examples:
 *   dev node tasks/create-share-link.js 1
 *   dev node tasks/create-share-link.js 2 snugglebug
 */

import { Account, Artifact, SharedView, App } from "#src/models/index.js";

// Parse command line arguments
const familyNumber = parseInt(process.argv[2]) || 1;
const appSlug = process.argv[3] || "demo";

console.log(`🔗 Creating share link for Family ${familyNumber}'s latest story...`);

try {
  // Find the app
  const app = await App.query().findOne({ slug: appSlug });
  if (!app) {
    console.error(`❌ App not found: ${appSlug}`);
    process.exit(1);
  }

  // Find the test family
  const testAccount = await Account.query()
    .whereRaw("metadata->>'is_test_data' = ?", ['true'])
    .whereRaw("metadata->>'display_name' = ?", [`Test Family ${familyNumber}`])
    .where("app_id", app.id)
    .first();

  if (!testAccount) {
    console.error(`❌ Test Family ${familyNumber} not found. Run 'dev node tasks/generate-test-families.js' first.`);
    process.exit(1);
  }

  // Find the family's most recent story
  const latestArtifact = await Artifact.query()
    .where("account_id", testAccount.id)
    .where("app_id", app.id)
    .whereRaw("metadata->>'is_test_data' = ?", ['true'])
    .orderBy("created_at", "desc")
    .first();

  if (!latestArtifact) {
    console.error(`❌ No stories found for Family ${familyNumber}. Run 'dev node tasks/generate-test-story.js ${familyNumber}' first.`);
    process.exit(1);
  }

  // Create the shared view
  const sharedView = await SharedView.query().insert({
    artifact_id: latestArtifact.id,
    token: `share_test_family${familyNumber}_${Date.now()}`,
    permissions: {
      can_view: true,
      can_repersonalize: true,
      can_claim_characters: true,
      can_download: false
    },
    metadata: {
      created_for_testing: true,
      test_family: familyNumber,
      created_at: new Date().toISOString()
    }
  });

  console.log(`✅ Share link created successfully!`);
  console.log(`📧 Family: ${testAccount.email}`);
  console.log(`📖 Story: "${latestArtifact.title}"`);
  console.log(`🔗 Token: ${sharedView.token}`);
  console.log(`🌐 Share URL: http://localhost:3000/shared/${sharedView.token}`);
  
  console.log(`\n🧪 Test claiming by:`);
  console.log(`  1. Use Family ${familyNumber === 1 ? 2 : 1}'s account to view: GET /shared-views/${sharedView.token}`);
  console.log(`  2. Look for claimable actors with "is_claimable": true`);
  console.log(`  3. Claim an actor: POST /shared-views/${sharedView.token}/claim-actor`);
  console.log(`  4. Verify ownership transfer and family linking`);

  console.log(`\n📱 Frontend testing:`);
  console.log(`  • Open: http://localhost:3000/shared/${sharedView.token}`);
  console.log(`  • Sign in as different family to test claiming`);

  process.exit(0);
} catch (error) {
  console.error("❌ Failed to create share link:", error);
  process.exit(1);
}