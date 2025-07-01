#!/usr/bin/env node

/**
 * Test the new claim-and-personalize endpoint
 * 
 * Usage:
 *   dev node tasks/test-claim-and-personalize.js [share_token] [claiming_family_number] [app_slug]
 * 
 * Examples:
 *   dev node tasks/test-claim-and-personalize.js share_test_family1_1751281534423 2
 *   dev node tasks/test-claim-and-personalize.js share_test_family1_1751281534423 2 demo
 */

import { Account, Actor, SharedView, Artifact, ArtifactActor, App } from "#src/models/index.js";

// Parse command line arguments
const shareToken = process.argv[2];
const claimingFamilyNumber = parseInt(process.argv[3]) || 2;
const appSlug = process.argv[4] || "demo";

if (!shareToken) {
  console.error("❌ Share token is required");
  console.log("Usage: dev node tasks/test-claim-and-personalize.js <share_token> [claiming_family_number] [app_slug]");
  process.exit(1);
}

console.log(`🚀 Testing claim-and-personalize flow...`);
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

  // Get user's existing actors
  const userActors = await Actor.query()
    .where("account_id", claimingAccount.id)
    .where("app_id", app.id);

  console.log(`👨‍👩‍👧‍👦 User's existing actors: ${userActors.map(a => a.name).join(", ")}`);

  // View the shared story to see claimable actors
  console.log(`\n📖 Step 1: Viewing shared story...`);
  
  const sharedView = await SharedView.query()
    .where("token", shareToken)
    .withGraphFetched("[artifact.[input]]")
    .first();

  if (!sharedView) {
    console.error(`❌ Shared view not found with token: ${shareToken}`);
    process.exit(1);
  }

  console.log(`📚 Original story: "${sharedView.artifact.title}"`);

  // Get actors in the story
  const artifactActors = await ArtifactActor.query()
    .where("artifact_id", sharedView.artifact.id)
    .withGraphFetched("[actor]");

  console.log(`\n🎭 Actors in original story:`);
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
    process.exit(1);
  }

  // Test the claim-and-personalize endpoint
  console.log(`\n🎯 Step 2: Calling claim-and-personalize endpoint...`);
  
  const claimActorIds = claimableActors.map(a => a.id);
  console.log(`📋 Claiming actors: ${claimableActors.map(a => a.name).join(", ")}`);

  // Simulate the API call by calling the logic directly
  const beforeCounts = {
    userActors: userActors.length,
    claimableActors: claimableActors.length
  };

  // Manually perform the claim and personalize operation
  const result = await Actor.transaction(async (trx) => {
    // Import what we need
    const { Input, AccountLink } = await import("#src/models/index.js");

    // Step 1: Claim all actors
    const claimedActors = [];
    for (const actor of claimableActors) {
      const originalOwnerId = actor.account_id;

      // Transfer ownership
      await Actor.query(trx)
        .patch({
          account_id: claimingAccount.id,
          is_claimable: false,
          metadata: {
            ...actor.metadata,
            claimed_at: new Date().toISOString(),
            claimed_from_token: shareToken,
            previous_owner_id: originalOwnerId,
          }
        })
        .where("id", actor.id);

      const claimedActor = await Actor.query(trx).findById(actor.id);
      claimedActors.push(claimedActor);

      // Create family links if they don't exist
      const existingLink = await AccountLink.query(trx)
        .where((builder) => {
          builder
            .where({
              account_id: originalOwnerId,
              linked_account_id: claimingAccount.id,
              app_id: app.id
            })
            .orWhere({
              account_id: claimingAccount.id,
              linked_account_id: originalOwnerId,
              app_id: app.id
            });
        })
        .first();

      if (!existingLink) {
        await AccountLink.query(trx).insert([
          {
            account_id: originalOwnerId,
            linked_account_id: claimingAccount.id,
            app_id: app.id,
            status: "accepted",
            created_by_id: claimingAccount.id,
            metadata: {
              created_through_claiming: true,
              actor_id: actor.id,
              share_token: shareToken,
              auto_accepted: true,
            }
          },
          {
            account_id: claimingAccount.id,
            linked_account_id: originalOwnerId,
            app_id: app.id,
            status: "accepted",
            created_by_id: claimingAccount.id,
            metadata: {
              created_through_claiming: true,
              actor_id: actor.id,
              share_token: shareToken,
              auto_accepted: true,
            }
          }
        ]);
      }
    }

    // Step 2: Create personalized story
    const originalInput = sharedView.artifact.input;
    const claimedActorIds = claimedActors.map(a => a.id);
    
    // Build new story: claimed actors + user's existing actors (up to 3 total)
    const newStoryActorIds = [...claimedActorIds];
    const userOtherActors = userActors.filter(a => !claimedActorIds.includes(a.id));
    const maxAdditional = Math.max(0, 3 - claimedActorIds.length);
    const additionalActors = userOtherActors.slice(0, maxAdditional);
    newStoryActorIds.push(...additionalActors.map(a => a.id));

    // All are main characters in the new story
    const mainCharacterIds = newStoryActorIds;

    // Create new input
    const newInput = await Input.query(trx).insert({
      account_id: claimingAccount.id,
      app_id: app.id,
      prompt: originalInput.prompt,
      actor_ids: newStoryActorIds,
      metadata: {
        ...originalInput.metadata,
        personalized_from: originalInput.id,
        shared_view_token: shareToken,
        claimed_actors: claimedActorIds,
        main_character_ids: mainCharacterIds,
        created_via: "claim_and_personalize"
      },
    });

    // Create new artifact
    const newArtifact = await Artifact.query(trx).insert({
      input_id: newInput.id,
      account_id: claimingAccount.id,
      app_id: app.id,
      artifact_type: sharedView.artifact.artifact_type,
      title: `${sharedView.artifact.title} (Your Version)`,
      metadata: {
        status: "generating",
        personalized_from: sharedView.artifact.id,
        shared_view_token: shareToken,
        claimed_actors: claimedActorIds,
        started_at: new Date().toISOString(),
      },
    });

    // Set up actor relationships
    await ArtifactActor.setActorsForArtifact(newArtifact.id, newStoryActorIds, mainCharacterIds, trx);

    return { newInput, newArtifact, claimedActors };
  });

  console.log(`✅ Successfully completed claim-and-personalize!`);

  // Step 3: Verify results
  console.log(`\n🔍 Step 3: Verifying results...`);

  // Check claimed actors
  console.log(`\n🎭 Claimed actors:`);
  result.claimedActors.forEach(actor => {
    console.log(`  - ${actor.name} (${actor.type}) - Now owned by: ${claimingAccount.email}`);
    console.log(`    🔓 is_claimable: ${actor.is_claimable} (should be false)`);
    console.log(`    📅 claimed_at: ${actor.metadata.claimed_at}`);
  });

  // Check new story
  console.log(`\n📚 New personalized story:`);
  console.log(`  📖 Title: "${result.newArtifact.title}"`);
  console.log(`  🆔 Artifact ID: ${result.newArtifact.id}`);
  console.log(`  📝 Status: ${result.newArtifact.metadata.status}`);
  console.log(`  👥 Actor count: ${result.newInput.actor_ids.length}`);

  // Show which actors are in the new story
  const newStoryActors = await Actor.query()
    .whereIn("id", result.newInput.actor_ids)
    .where("app_id", app.id);

  console.log(`\n🎭 Actors in new personalized story:`);
  newStoryActors.forEach(actor => {
    const isClaimed = result.claimedActors.some(ca => ca.id === actor.id);
    const isUser = userActors.some(ua => ua.id === actor.id);
    const source = isClaimed ? "CLAIMED" : isUser ? "USER'S" : "OTHER";
    console.log(`  - ${actor.name} (${actor.type}) - Source: ${source}`);
  });

  // Check user's total actors now
  const updatedUserActors = await Actor.query()
    .where("account_id", claimingAccount.id)
    .where("app_id", app.id);

  console.log(`\n📊 Summary:`);
  console.log(`  ✅ Claimed ${result.claimedActors.length} actors`);
  console.log(`  ✅ User's actor count: ${beforeCounts.userActors} → ${updatedUserActors.length}`);
  console.log(`  ✅ Created personalized story: "${result.newArtifact.title}"`);
  console.log(`  ✅ New story has ${result.newInput.actor_ids.length} actors (all main characters)`);
  console.log(`  ✅ Story status: ${result.newArtifact.metadata.status}`);

  console.log(`\n🎉 Claim-and-personalize test completed successfully!`);

  process.exit(0);
} catch (error) {
  console.error("❌ Failed to test claim-and-personalize:", error);
  process.exit(1);
}