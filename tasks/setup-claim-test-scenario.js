#!/usr/bin/env node

/**
 * Setup complete claim-and-personalize test scenario
 * 
 * Creates:
 * 1. New test family
 * 2. Main character (child) - not claimable
 * 3. Secondary character (child) - claimable
 * 4. Story with main character as main, secondary as supporting
 * 5. Share link for the story
 * 
 * Usage:
 *   dev node tasks/setup-claim-test-scenario.js [family_number] [main_character_name] [claimable_character_name] [app_slug]
 * 
 * Examples:
 *   dev node tasks/setup-claim-test-scenario.js
 *   dev node tasks/setup-claim-test-scenario.js 5 "Emma" "Kyle"
 *   dev node tasks/setup-claim-test-scenario.js 3 "Sofia" "Her Friend Alex" demo
 */

import { Account, Actor, Input, Artifact, ArtifactActor, ArtifactPage, SharedView, App } from "#src/models/index.js";
import { randomBytes } from "crypto";

// Parse command line arguments
const familyNumber = parseInt(process.argv[2]) || 1;
const mainCharacterName = process.argv[3] || "Emma";
const claimableCharacterName = process.argv[4] || "Kyle";
const appSlug = process.argv[5] || "demo";

console.log(`🚀 Setting up complete claim test scenario...`);
console.log(`👨‍👩‍👧‍👦 Family: ${familyNumber}`);
console.log(`🌟 Main Character: ${mainCharacterName}`);
console.log(`🔓 Claimable Character: ${claimableCharacterName}`);
console.log(`📱 App: ${appSlug}`);

try {
  // Find the app
  const app = await App.query().findOne({ slug: appSlug });
  if (!app) {
    console.error(`❌ App not found: ${appSlug}`);
    process.exit(1);
  }

  console.log(`✅ Found app: ${app.name}`);

  // Step 1: Create new test family
  console.log(`\n📝 Step 1: Creating test family...`);
  
  const familyId = randomBytes(8).toString('hex');
  const clerkId = `test_family_${familyId}`;
  const email = `family${familyNumber}@testfamilies.com`;

  const account = await Account.query().insert({
    clerk_id: clerkId,
    email: email,
    app_id: app.id,
    metadata: {
      display_name: `Test Family ${familyNumber}`,
      is_test_data: true,
      generated_at: new Date().toISOString(),
      scenario: "claim_test_setup"
    }
  });

  console.log(`✅ Created family: ${account.email}`);

  // Step 2: Create main character (not claimable)
  console.log(`\n🌟 Step 2: Creating main character...`);
  
  const mainCharacter = await Actor.query().insert({
    account_id: account.id,
    app_id: app.id,
    name: mainCharacterName,
    type: "child",
    is_claimable: false, // Main character is NOT claimable
    metadata: {
      is_test_data: true,
      role: "main_character",
      age: Math.floor(Math.random() * 6) + 5, // 5-10 years old
      traits: ["curious", "brave", "kind", "adventurous"],
      description: `The main character of the story - ${account.metadata.display_name}'s child`
    }
  });

  console.log(`✅ Created main character: ${mainCharacter.name}`);
  console.log(`   🔒 Claimable: ${mainCharacter.is_claimable} (main characters are not claimable)`);
  console.log(`   🎭 Type: ${mainCharacter.type}`);
  console.log(`   🆔 Actor ID: ${mainCharacter.id}`);

  // Step 3: Create secondary/claimable character
  console.log(`\n🔓 Step 3: Creating claimable character...`);
  
  const claimableCharacter = await Actor.query().insert({
    account_id: account.id,
    app_id: app.id,
    name: claimableCharacterName,
    type: "child",
    is_claimable: true, // Secondary character IS claimable
    metadata: {
      is_test_data: true,
      role: "claimable_character",
      age: Math.floor(Math.random() * 6) + 5, // 5-10 years old
      traits: ["friendly", "playful", "loyal", "fun"],
      description: `A claimable character that other families can adopt`,
      claimable_info: {
        intended_for_claiming: true,
        character_type: "friend"
      }
    }
  });

  console.log(`✅ Created claimable character: ${claimableCharacter.name}`);
  console.log(`   🔓 Claimable: ${claimableCharacter.is_claimable} (can be claimed by other families)`);
  console.log(`   🎭 Type: ${claimableCharacter.type}`);
  console.log(`   🆔 Actor ID: ${claimableCharacter.id}`);

  // Step 4: Create story with proper character roles
  console.log(`\n📖 Step 4: Creating story...`);
  
  const storyPrompt = generateStoryPrompt(mainCharacterName, claimableCharacterName);
  console.log(`💭 Story prompt: "${storyPrompt}"`);

  const allActorIds = [mainCharacter.id, claimableCharacter.id];
  const mainCharacterIds = [mainCharacter.id]; // Only the main character is marked as main

  // Create input
  const input = await Input.query().insert({
    account_id: account.id,
    app_id: app.id,
    prompt: storyPrompt,
    actor_ids: allActorIds,
    metadata: {
      is_test_data: true,
      scenario: "claim_test_setup",
      character_roles: {
        main_character: mainCharacter.id,
        claimable_character: claimableCharacter.id
      },
      generated_at: new Date().toISOString()
    }
  });

  // Create artifact
  const storyTitle = `${mainCharacterName} & ${claimableCharacterName}'s Adventure`;
  const artifact = await Artifact.query().insert({
    input_id: input.id,
    account_id: account.id,
    app_id: app.id,
    artifact_type: "story",
    title: storyTitle,
    metadata: {
      status: "completed", // Mark as completed for immediate testing
      is_test_data: true,
      scenario: "claim_test_setup",
      page_count: 6,
      generated_at: new Date().toISOString()
    }
  });

  // Set up actor relationships
  await ArtifactActor.setActorsForArtifact(artifact.id, allActorIds, mainCharacterIds);

  console.log(`✅ Created story: "${artifact.title}"`);
  console.log(`   📚 Story ID: ${artifact.id}`);
  console.log(`   🌟 Main character: ${mainCharacterName} (${mainCharacter.id})`);
  console.log(`   🔓 Claimable character: ${claimableCharacterName} (${claimableCharacter.id})`);

  // Create story pages
  const storyContent = generateStoryContent(mainCharacterName, claimableCharacterName, storyPrompt);
  
  for (let i = 0; i < storyContent.length; i++) {
    await ArtifactPage.query().insert({
      artifact_id: artifact.id,
      page_number: i + 1,
      text: storyContent[i],
      // Omit image_key for test stories
      layout_data: {
        is_test_data: true,
        text_only: true,
        scenario: "claim_test_setup"
      }
    });
  }

  console.log(`   📄 Pages: ${storyContent.length}`);

  // Step 5: Create share link
  console.log(`\n🔗 Step 5: Creating share link...`);
  
  const shareToken = `share_test_family${familyNumber}_${Date.now()}`;
  const sharedView = await SharedView.query().insert({
    artifact_id: artifact.id,
    token: shareToken,
    permissions: {
      can_view: true,
      can_repersonalize: true,
      can_claim_characters: true, // Enable character claiming
      can_download: false
    },
    metadata: {
      is_test_data: true,
      scenario: "claim_test_setup",
      family_number: familyNumber,
      created_at: new Date().toISOString(),
      setup_info: {
        main_character: mainCharacter.id,
        claimable_character: claimableCharacter.id
      }
    }
  });

  console.log(`✅ Created share link!`);
  console.log(`   🔗 Token: ${sharedView.token}`);
  console.log(`   🌐 Share URL: http://localhost:3000/shared/${sharedView.token}`);
  console.log(`   ✅ Claiming enabled: ${sharedView.permissions.can_claim_characters}`);

  // Step 6: Display test instructions
  console.log(`\n🎉 Complete claim test scenario ready!`);
  
  console.log(`\n📋 Test Scenario Summary:`);
  console.log(`  👨‍👩‍👧‍👦 Family: ${account.email} (${account.metadata.display_name})`);
  console.log(`  🌟 Main Character: ${mainCharacter.name} (not claimable)`);
  console.log(`  🔓 Claimable Character: ${claimableCharacter.name} (can be claimed)`);
  console.log(`  📖 Story: "${artifact.title}"`);
  console.log(`  🔗 Share Token: ${sharedView.token}`);

  console.log(`\n🧪 Test the claim-and-personalize flow:`);
  console.log(`  1. Create another family:`);
  console.log(`     dev node tasks/generate-test-families.js 1`);
  console.log(`  `);
  console.log(`  2. Test the new endpoint:`);
  console.log(`     dev node tasks/test-claim-and-personalize.js ${sharedView.token} 1`);
  console.log(`  `);
  console.log(`  3. Or view the shared story:`);
  console.log(`     curl http://localhost:4001/shared-views/${sharedView.token} -H "X-App-Slug: ${appSlug}"`);

  console.log(`\n🎯 Expected Results:`);
  console.log(`  ✅ Family 1 can view the shared story`);
  console.log(`  ✅ ${claimableCharacter.name} shows as claimable`);
  console.log(`  ✅ ${mainCharacter.name} shows as NOT claimable`);
  console.log(`  ✅ Family 1 can claim ${claimableCharacter.name}`);
  console.log(`  ✅ New personalized story gets generated`);
  console.log(`  ✅ Families get linked automatically`);

  process.exit(0);
} catch (error) {
  console.error("❌ Failed to setup claim test scenario:", error);
  process.exit(1);
}

/**
 * Generate a story prompt based on the character names
 */
function generateStoryPrompt(mainCharacter, claimableCharacter) {
  const prompts = [
    `${mainCharacter} and ${claimableCharacter} discover a magical door in their backyard`,
    `${mainCharacter} and ${claimableCharacter} go on a treasure hunt in the neighborhood`, 
    `${mainCharacter} and ${claimableCharacter} find a talking animal in the forest`,
    `${mainCharacter} and ${claimableCharacter} have an amazing adventure at the park`,
    `${mainCharacter} and ${claimableCharacter} explore a mysterious cave`,
    `${mainCharacter} and ${claimableCharacter} help solve a neighborhood mystery`,
    `${mainCharacter} and ${claimableCharacter} go camping and discover something wonderful`,
    `${mainCharacter} and ${claimableCharacter} find a secret passage in their school`,
    `${mainCharacter} and ${claimableCharacter} rescue a lost pet and become heroes`,
    `${mainCharacter} and ${claimableCharacter} discover they have magical powers`
  ];

  return prompts[Math.floor(Math.random() * prompts.length)];
}

/**
 * Generate story content for the test scenario
 */
function generateStoryContent(mainCharacter, claimableCharacter, prompt) {
  const pages = [
    `Once upon a time, ${prompt.toLowerCase()}. It was going to be the most exciting day ever for both friends!`,
    
    `${mainCharacter} woke up bright and early, excited to see ${claimableCharacter}. "${claimableCharacter}!" called ${mainCharacter}, "Come on, let's go on an adventure!"`,
    
    `The two friends set off together, not knowing what amazing things they would discover. ${claimableCharacter} was always ready for fun, and ${mainCharacter} loved having such a great friend.`,
    
    `As they explored, ${mainCharacter} and ${claimableCharacter} found something incredible. "Wow!" they both said at the same time. This was going to be even better than they had imagined.`,
    
    `Working together, ${mainCharacter} and ${claimableCharacter} faced a small challenge. But with ${mainCharacter}'s bravery and ${claimableCharacter}'s cleverness, they found the perfect solution.`,
    
    `By the end of their adventure, both ${mainCharacter} and ${claimableCharacter} had learned something special about friendship. They couldn't wait to share their amazing story with their families! The End.`
  ];

  return pages;
}