#!/usr/bin/env node

/**
 * Generate test families for testing family linking functionality
 * 
 * Usage:
 *   dev node tasks/generate-test-families.js [family_count] [app_slug]
 * 
 * Examples:
 *   dev node tasks/generate-test-families.js
 *   dev node tasks/generate-test-families.js 3
 *   dev node tasks/generate-test-families.js 5 snugglebug
 */

import { Account, Actor, AccountLink, App } from "#src/models/index.js";
import { randomBytes } from "crypto";

// Parse command line arguments
const familyCount = parseInt(process.argv[2]) || 1;
const appSlug = process.argv[3] || "demo";

if (familyCount < 1 || familyCount > 10) {
  console.error("❌ Family count must be between 1 and 10");
  process.exit(1);
}

console.log(`🏗️ Generating ${familyCount} test families for app: ${appSlug}`);

try {
  // Find the app
  const app = await App.query().findOne({ slug: appSlug });
  if (!app) {
    console.error(`❌ App not found: ${appSlug}`);
    process.exit(1);
  }

  const createdFamilies = [];

  // Generate families
  for (let i = 1; i <= familyCount; i++) {
    const family = await generateSingleFamily(app, i);
    createdFamilies.push(family);
    console.log(`✅ Created family ${i}/${familyCount}: ${family.account.email}`);
  }

  // Link all families together if more than one
  if (createdFamilies.length > 1) {
    console.log(`🔗 Linking ${createdFamilies.length} families together...`);
    await linkFamiliesTogether(createdFamilies, app);
  }

  console.log(`🎉 Successfully generated ${familyCount} test families!`);
  console.log(`\n📋 Summary:`);
  createdFamilies.forEach((family, index) => {
    console.log(`  Family ${index + 1}: ${family.account.email}`);
    family.actors.forEach(actor => {
      console.log(`    - ${actor.name} (${actor.type})`);
    });
  });

  console.log(`\n🧪 Test these families by using: GET /account-links/actors`);
  console.log(`🧹 Clean up test data with: dev node tasks/cleanup-test-data.js`);

  process.exit(0);
} catch (error) {
  console.error("❌ Failed to generate test families:", error);
  process.exit(1);
}

/**
 * Generate a single family with random actors
 */
async function generateSingleFamily(app, familyIndex) {
  const familyId = randomBytes(8).toString('hex');
  const clerkId = `test_family_${familyId}`;
  const email = `family${familyIndex}@testfamilies.com`;

  // Create account
  const account = await Account.query().insert({
    clerk_id: clerkId,
    email: email,
    app_id: app.id,
    metadata: {
      display_name: `Test Family ${familyIndex}`,
      is_test_data: true,
      generated_at: new Date().toISOString()
    }
  });

  // Generate 1-3 random actors per family
  const actorCount = Math.floor(Math.random() * 3) + 1; // 1-3 actors
  const actors = [];

  for (let j = 1; j <= actorCount; j++) {
    const actor = await generateRandomActor(account, app, j);
    actors.push(actor);
  }

  return { account, actors };
}

/**
 * Generate a random actor for a family
 */
async function generateRandomActor(account, app, actorIndex) {
  const actorTypes = ['child', 'pet', 'adult'];
  const childNames = ['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Lucas', 'Mia', 'Mason'];
  const petNames = ['Buddy', 'Luna', 'Charlie', 'Bella', 'Max', 'Daisy', 'Rocky', 'Rosie', 'Jack', 'Molly'];
  const adultNames = ['Mom', 'Dad', 'Grandma', 'Grandpa', 'Aunt Sarah', 'Uncle Mike', 'Cousin Alex'];
  
  const type = actorTypes[Math.floor(Math.random() * actorTypes.length)];
  let name;
  
  switch (type) {
    case 'child':
      name = childNames[Math.floor(Math.random() * childNames.length)];
      break;
    case 'pet':
      name = petNames[Math.floor(Math.random() * petNames.length)];
      break;
    case 'adult':
      name = adultNames[Math.floor(Math.random() * adultNames.length)];
      break;
  }

  // Extract family number from display name for unique naming
  const familyNum = account.metadata.display_name.match(/\d+/)[0];
  const uniqueName = `${name} (Family ${familyNum})`;

  const actor = await Actor.query().insert({
    account_id: account.id,
    app_id: app.id,
    name: uniqueName,
    type: type,
    metadata: {
      is_test_data: true,
      generated_at: new Date().toISOString(),
      family_index: familyNum,
      traits: generateRandomTraits(type)
    }
  });

  console.log(`  📝 Created ${type}: ${uniqueName}`);
  return actor;
}

/**
 * Generate random traits for an actor based on type
 */
function generateRandomTraits(type) {
  const childTraits = ['playful', 'curious', 'energetic', 'shy', 'brave', 'creative', 'funny'];
  const petTraits = ['loyal', 'fluffy', 'playful', 'sleepy', 'energetic', 'cuddly', 'mischievous'];
  const adultTraits = ['caring', 'wise', 'funny', 'patient', 'adventurous', 'gentle', 'strong'];
  
  let traitPool;
  switch (type) {
    case 'child':
      traitPool = childTraits;
      break;
    case 'pet':
      traitPool = petTraits;
      break;
    case 'adult':
      traitPool = adultTraits;
      break;
    default:
      traitPool = ['friendly', 'interesting', 'unique'];
  }
  
  // Select 2-3 random traits
  const numTraits = Math.floor(Math.random() * 2) + 2; // 2-3 traits
  const selectedTraits = [];
  
  while (selectedTraits.length < numTraits && selectedTraits.length < traitPool.length) {
    const trait = traitPool[Math.floor(Math.random() * traitPool.length)];
    if (!selectedTraits.includes(trait)) {
      selectedTraits.push(trait);
    }
  }
  
  return selectedTraits;
}

/**
 * Create bidirectional links between all families
 */
async function linkFamiliesTogether(families, app) {
  for (let i = 0; i < families.length; i++) {
    for (let j = i + 1; j < families.length; j++) {
      const family1 = families[i];
      const family2 = families[j];
      
      // Create bidirectional links
      await AccountLink.query().insert({
        account_id: family1.account.id,
        linked_account_id: family2.account.id,
        app_id: app.id,
        status: "accepted", // Auto-accept for testing
        created_by_id: family1.account.id,
        metadata: {
          is_test_data: true,
          auto_accepted: true,
          created_at: new Date().toISOString()
        }
      });

      await AccountLink.query().insert({
        account_id: family2.account.id,
        linked_account_id: family1.account.id,
        app_id: app.id,
        status: "accepted", // Auto-accept for testing
        created_by_id: family2.account.id,
        metadata: {
          is_test_data: true,
          auto_accepted: true,
          created_at: new Date().toISOString()
        }
      });

      console.log(`  🔗 Linked ${family1.account.email} ↔ ${family2.account.email}`);
    }
  }
}