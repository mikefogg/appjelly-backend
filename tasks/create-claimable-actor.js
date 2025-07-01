#!/usr/bin/env node

/**
 * Create a claimable actor for testing the claiming system
 * 
 * Usage:
 *   dev node tasks/create-claimable-actor.js [family_number] [actor_name] [actor_type]
 * 
 * Examples:
 *   dev node tasks/create-claimable-actor.js 1 "Sarah's Friend Kyle" child
 *   dev node tasks/create-claimable-actor.js 2 "Fluffy" pet
 *   dev node tasks/create-claimable-actor.js 3 "Uncle Mike" adult
 */

import { Account, Actor, App } from "#src/models/index.js";

// Parse command line arguments
const familyNumber = parseInt(process.argv[2]) || 1;
const actorName = process.argv[3] || `Claimable Friend ${familyNumber}`;
const actorType = process.argv[4] || "child";
const appSlug = process.argv[5] || "demo";

console.log(`🎭 Creating claimable actor for Family ${familyNumber}: ${actorName} (${actorType})`);

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

  // Validate actor type
  const validTypes = ["child", "pet", "adult", "character", "other"];
  if (!validTypes.includes(actorType)) {
    console.error(`❌ Invalid actor type: ${actorType}. Must be one of: ${validTypes.join(", ")}`);
    process.exit(1);
  }

  // Create the claimable actor
  const actor = await Actor.query().insert({
    account_id: testAccount.id,
    app_id: app.id,
    name: actorName,
    type: actorType,
    is_claimable: true, // This is the key difference!
    metadata: {
      is_test_data: true,
      generated_at: new Date().toISOString(),
      claimable_actor: true,
      description: `A ${actorType} that can be claimed by other families through story sharing`,
      traits: generateTraitsForType(actorType)
    }
  });

  console.log(`✅ Created claimable actor: ${actor.name}`);
  console.log(`   📧 Owner: ${testAccount.email}`);
  console.log(`   🎭 Type: ${actorType}`);
  console.log(`   🔓 Claimable: ${actor.is_claimable}`);
  console.log(`   🆔 Actor ID: ${actor.id}`);

  console.log(`\n🧪 Test claiming by:`);
  console.log(`  1. Create a story with this actor as a main character`);
  console.log(`  2. Share the story to get a token`);
  console.log(`  3. Use another family account to view and claim the actor`);
  console.log(`  4. Verify the actor ownership transfers and families are linked`);

  process.exit(0);
} catch (error) {
  console.error("❌ Failed to create claimable actor:", error);
  process.exit(1);
}

/**
 * Generate appropriate traits for different actor types
 */
function generateTraitsForType(type) {
  const traitsByType = {
    child: ["friendly", "curious", "playful", "energetic"],
    pet: ["loyal", "fluffy", "playful", "cuddly"],
    adult: ["caring", "wise", "helpful", "patient"],
    character: ["magical", "adventurous", "mysterious", "brave"],
    other: ["unique", "interesting", "special", "memorable"]
  };

  return traitsByType[type] || traitsByType.other;
}