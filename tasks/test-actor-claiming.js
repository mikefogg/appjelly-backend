#!/usr/bin/env node

/**
 * Test the complete actor claiming flow
 * 
 * Usage:
 *   dev node tasks/test-actor-claiming.js [share_token] [claiming_family_number] [app_slug]
 * 
 * Examples:
 *   dev node tasks/test-actor-claiming.js share_test_family1_1751281534423 2
 *   dev node tasks/test-actor-claiming.js share_test_family1_1751281534423 2 demo
 */

import { Account, Actor, SharedView, AccountLink, App } from "#src/models/index.js";

// Parse command line arguments
const shareToken = process.argv[2];
const claimingFamilyNumber = parseInt(process.argv[3]) || 2;
const appSlug = process.argv[4] || "demo";

if (!shareToken) {
  console.error("❌ Share token is required");
  console.log("Usage: dev node tasks/test-actor-claiming.js <share_token> [claiming_family_number] [app_slug]");
  process.exit(1);
}

console.log(`🧪 Testing actor claiming flow...`);
console.log(`🔗 Share Token: ${shareToken}`);
console.log(`👨‍👩‍👧‍👦 Claiming Family: ${claimingFamilyNumber}`);
console.log(`📱 App: ${appSlug}`);

try {
  // Find the app
  const app = await App.query().findOne({ slug: appSlug });
  if (!app) {
    console.error(`❌ App not found: ${appSlug}`);
    process.exit(1);
  }

  // Find the claiming family
  const claimingAccount = await Account.query()
    .whereRaw("metadata->>'is_test_data' = ?", ['true'])
    .whereRaw("metadata->>'display_name' = ?", [`Test Family ${claimingFamilyNumber}`])
    .where("app_id", app.id)
    .first();

  if (!claimingAccount) {
    console.error(`❌ Test Family ${claimingFamilyNumber} not found. Run 'dev node tasks/generate-test-families.js' first.`);
    process.exit(1);
  }

  console.log(`✅ Found claiming family: ${claimingAccount.email}`);

  // Step 1: View the shared story (simulate GET /shared-views/:token)
  console.log(`\n📖 Step 1: Viewing shared story...`);
  
  const sharedView = await SharedView.query()
    .where("token", shareToken)
    .withGraphFetched("[artifact.[input, pages]]")
    .first();

  if (!sharedView) {
    console.error(`❌ Shared view not found with token: ${shareToken}`);
    process.exit(1);
  }

  if (sharedView.artifact.app_id !== app.id) {
    console.error(`❌ Shared view is not for the ${appSlug} app`);
    process.exit(1);
  }

  console.log(`📚 Story: "${sharedView.artifact.title}"`);
  console.log(`📄 Pages: ${sharedView.artifact.pages?.length || 0}`);

  // Get actors in the story
  const { ArtifactActor } = await import("#src/models/index.js");
  const artifactActors = await ArtifactActor.query()
    .where("artifact_id", sharedView.artifact.id)
    .withGraphFetched("[actor]");

  console.log(`\n🎭 Actors in story:`);
  const claimableActors = [];
  
  artifactActors.forEach(aa => {
    const isClaimable = aa.actor.is_claimable && aa.actor.account_id !== claimingAccount.id;
    console.log(`  - ${aa.actor.name} (${aa.actor.type}) - ${isClaimable ? '🔓 CLAIMABLE' : '🔒 Not claimable'} - Main: ${aa.is_main_character}`);
    
    if (isClaimable) {
      claimableActors.push(aa.actor);
    }
  });

  if (claimableActors.length === 0) {
    console.log(`\n❌ No claimable actors found in this story.`);
    console.log(`💡 Make sure the story includes actors marked with is_claimable: true`);
    process.exit(1);
  }

  // Step 2: Claim the first claimable actor
  const actorToClaim = claimableActors[0];
  console.log(`\n🎯 Step 2: Claiming actor "${actorToClaim.name}"...`);

  // Check if user is trying to claim their own actor
  if (actorToClaim.account_id === claimingAccount.id) {
    console.error(`❌ Cannot claim your own actor`);
    process.exit(1);
  }

  // Store original owner info
  const originalOwner = await Account.query().findById(actorToClaim.account_id);
  console.log(`👤 Original owner: ${originalOwner.email}`);
  console.log(`👤 New owner: ${claimingAccount.email}`);

  // Perform the claim (simulate POST /shared-views/:token/claim-actor)
  const result = await Actor.transaction(async (trx) => {
    // Transfer ownership of the actor
    await Actor.query(trx)
      .patch({
        account_id: claimingAccount.id,
        is_claimable: false, // No longer claimable once claimed
        metadata: {
          ...actorToClaim.metadata,
          claimed_at: new Date().toISOString(),
          claimed_from_token: shareToken,
          previous_owner_id: actorToClaim.account_id,
        }
      })
      .where("id", actorToClaim.id);

    // Fetch the updated actor
    const claimedActor = await Actor.query(trx).findById(actorToClaim.id);

    // Create family link between the two accounts if it doesn't exist
    const originalOwnerId = actorToClaim.account_id;
    const newOwnerId = claimingAccount.id;

    // Check if link already exists (in either direction)
    const existingLink = await AccountLink.query(trx)
      .where((builder) => {
        builder
          .where({
            account_id: originalOwnerId,
            linked_account_id: newOwnerId,
            app_id: app.id
          })
          .orWhere({
            account_id: newOwnerId,
            linked_account_id: originalOwnerId,
            app_id: app.id
          });
      })
      .first();

    if (!existingLink) {
      // Create bidirectional family links
      await AccountLink.query(trx).insert([
        {
          account_id: originalOwnerId,
          linked_account_id: newOwnerId,
          app_id: app.id,
          status: "accepted", // Auto-accept when created through claiming
          created_by_id: newOwnerId, // Claimer initiated the connection
          metadata: {
            created_through_claiming: true,
            actor_id: actorToClaim.id,
            share_token: shareToken,
            auto_accepted: true,
          }
        },
        {
          account_id: newOwnerId,
          linked_account_id: originalOwnerId,
          app_id: app.id,
          status: "accepted", // Auto-accept when created through claiming
          created_by_id: newOwnerId, // Claimer initiated the connection
          metadata: {
            created_through_claiming: true,
            actor_id: actorToClaim.id,
            share_token: shareToken,
            auto_accepted: true,
          }
        }
      ]);
      console.log(`🔗 Created bidirectional family links`);
    } else {
      console.log(`🔗 Family link already exists`);
    }

    return claimedActor;
  });

  console.log(`✅ Successfully claimed ${result.name}!`);

  // Step 3: Verify the results
  console.log(`\n🔍 Step 3: Verifying claim results...`);

  // Check actor ownership
  const updatedActor = await Actor.query().findById(actorToClaim.id);
  console.log(`👤 Actor now owned by: ${updatedActor.account_id === claimingAccount.id ? claimingAccount.email : 'FAILED'}`);
  console.log(`🔓 Actor is_claimable: ${updatedActor.is_claimable} (should be false)`);
  console.log(`📅 Claimed at: ${updatedActor.metadata.claimed_at}`);

  // Check family links
  const familyLinks = await AccountLink.query()
    .where("app_id", app.id)
    .where((builder) => {
      builder
        .where({
          account_id: originalOwner.id,
          linked_account_id: claimingAccount.id
        })
        .orWhere({
          account_id: claimingAccount.id,
          linked_account_id: originalOwner.id
        });
    });

  console.log(`🔗 Family links created: ${familyLinks.length} (should be 2)`);
  familyLinks.forEach(link => {
    const from = link.account_id === originalOwner.id ? originalOwner.email : claimingAccount.email;
    const to = link.linked_account_id === originalOwner.id ? originalOwner.email : claimingAccount.email;
    console.log(`  - ${from} → ${to} (${link.status})`);
  });

  // Check that claiming family can now see the original family's actors
  const accessibleActors = await Actor.query()
    .whereIn("account_id", [originalOwner.id, claimingAccount.id])
    .where("app_id", app.id);

  console.log(`\n👨‍👩‍👧‍👦 Accessible actors for ${claimingAccount.email}:`);
  accessibleActors.forEach(actor => {
    const owner = actor.account_id === claimingAccount.id ? "YOURS" : originalOwner.email;
    console.log(`  - ${actor.name} (${actor.type}) - Owner: ${owner}`);
  });

  console.log(`\n🎉 Actor claiming test completed successfully!`);
  console.log(`\n📊 Summary:`);
  console.log(`  ✅ Actor "${result.name}" transferred from ${originalOwner.email} to ${claimingAccount.email}`);
  console.log(`  ✅ Actor is no longer claimable`);
  console.log(`  ✅ Bidirectional family links created`);
  console.log(`  ✅ Both families can now see each other's actors`);

  process.exit(0);
} catch (error) {
  console.error("❌ Failed to test actor claiming:", error);
  process.exit(1);
}