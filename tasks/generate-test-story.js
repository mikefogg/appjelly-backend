#!/usr/bin/env node

/**
 * Generate a test story for one of the test families
 * 
 * Usage:
 *   dev node tasks/generate-test-story.js [family_number] [app_slug]
 * 
 * Examples:
 *   dev node tasks/generate-test-story.js
 *   dev node tasks/generate-test-story.js 2
 *   dev node tasks/generate-test-story.js 1 snugglebug
 */

import { Account, Actor, Input, Artifact, ArtifactActor, ArtifactPage, App } from "#src/models/index.js";

// Parse command line arguments
const familyNumber = parseInt(process.argv[2]) || 1;
const appSlug = process.argv[3] || "demo";

console.log(`📖 Generating test story for Family ${familyNumber} in app: ${appSlug}`);

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
    .withGraphFetched("[actors]")
    .first();

  if (!testAccount) {
    console.error(`❌ Test Family ${familyNumber} not found. Run 'dev node tasks/generate-test-families.js' first.`);
    process.exit(1);
  }

  if (!testAccount.actors || testAccount.actors.length === 0) {
    console.error(`❌ Test Family ${familyNumber} has no actors.`);
    process.exit(1);
  }

  console.log(`✅ Found ${testAccount.email} with ${testAccount.actors.length} actors:`);
  testAccount.actors.forEach(actor => {
    console.log(`  - ${actor.name} (${actor.type})`);
  });

  // Select 1-3 random actors for the story
  const maxActors = Math.min(3, testAccount.actors.length);
  const numActors = Math.floor(Math.random() * maxActors) + 1;
  const selectedActors = testAccount.actors
    .sort(() => 0.5 - Math.random())
    .slice(0, numActors);

  console.log(`\n📝 Creating story with ${numActors} actors:`);
  selectedActors.forEach(actor => {
    console.log(`  ⭐ ${actor.name}`);
  });

  // Generate a random story prompt based on the actors
  const prompt = generateStoryPrompt(selectedActors);
  console.log(`\n💭 Story prompt: "${prompt}"`);

  // Create the input
  const input = await Input.query().insert({
    account_id: testAccount.id,
    app_id: app.id,
    prompt: prompt,
    actor_ids: selectedActors.map(a => a.id),
    metadata: {
      is_test_data: true,
      generated_at: new Date().toISOString(),
      test_story: true
    }
  });

  // Create the artifact with generated story content
  const storyContent = generateStoryContent(selectedActors, prompt);
  
  const artifact = await Artifact.query().insert({
    input_id: input.id,
    account_id: testAccount.id,
    app_id: app.id,
    artifact_type: "story",
    title: `Test Story - ${selectedActors.map(a => a.name.split(' ')[0]).join(' & ')}`,
    metadata: {
      status: "completed",
      is_test_data: true,
      generated_at: new Date().toISOString(),
      page_count: storyContent.length
    }
  });

  // Set up actor relationships (all selected actors as main characters)
  const actorIds = selectedActors.map(a => a.id);
  await ArtifactActor.setActorsForArtifact(artifact.id, actorIds, actorIds);

  // Create story pages
  for (let i = 0; i < storyContent.length; i++) {
    await ArtifactPage.query().insert({
      artifact_id: artifact.id,
      page_number: i + 1,
      text: storyContent[i],
      // Omit image_key for test stories (no images)
      layout_data: {
        is_test_data: true,
        text_only: true
      }
    });
  }

  console.log(`\n🎉 Successfully created test story!`);
  console.log(`📚 Story ID: ${artifact.id}`);
  console.log(`📄 Pages: ${storyContent.length}`);
  console.log(`\n🧪 Test sharing by:`);
  console.log(`  1. Use any linked family account's token`);
  console.log(`  2. GET /artifacts to see if they can view this story`);
  console.log(`  3. GET /artifacts/${artifact.id} to read the full story`);

  process.exit(0);
} catch (error) {
  console.error("❌ Failed to generate test story:", error);
  process.exit(1);
}

/**
 * Generate a story prompt based on the selected actors
 */
function generateStoryPrompt(actors) {
  const prompts = [
    "goes on a magical adventure in their backyard",
    "discovers a secret door in their house",
    "finds a talking animal in the forest",
    "goes on a treasure hunt",
    "has an amazing day at the park",
    "learns something new and exciting",
    "helps solve a mystery in the neighborhood",
    "goes on a camping trip",
    "visits a magical place",
    "has a fun day playing together"
  ];

  const actorNames = actors.map(a => a.name.split(' ')[0]); // Just first names
  const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
  
  if (actorNames.length === 1) {
    return `${actorNames[0]} ${randomPrompt}`;
  } else if (actorNames.length === 2) {
    return `${actorNames[0]} and ${actorNames[1]} ${randomPrompt}`;
  } else {
    const lastActor = actorNames.pop();
    return `${actorNames.join(', ')}, and ${lastActor} ${randomPrompt}`;
  }
}

/**
 * Generate simple story content for testing
 */
function generateStoryContent(actors, prompt) {
  const actorNames = actors.map(a => a.name.split(' ')[0]);
  const mainCharacter = actorNames[0];
  
  const pages = [
    `Once upon a time, ${prompt.toLowerCase()}. It was going to be the most exciting day ever!`,
    
    `${mainCharacter} ${actorNames.length > 1 ? `and ${actorNames.slice(1).join(' and ')} ` : ''}started their adventure early in the morning. The sun was shining brightly, and everything seemed perfect for an adventure.`,
    
    `As they explored, ${mainCharacter} discovered something amazing. "Look!" ${actorNames.length > 1 ? 'they' : mainCharacter} called out excitedly. This was going to be even better than they had imagined.`,
    
    `The adventure continued as ${actorNames.length > 1 ? 'the friends' : mainCharacter} faced a small challenge. But working together${actorNames.length === 1 ? ' with determination' : ''}, they found a clever solution.`,
    
    `By the end of the day, ${actorNames.length > 1 ? 'everyone' : mainCharacter} had learned something special. ${actorNames.length > 1 ? 'They' : mainCharacter} couldn't wait to share their amazing adventure with others!`,
    
    `And so ${mainCharacter}${actorNames.length > 1 ? ` and ${actorNames.slice(1).join(' and ')}` : ''} went home happy, knowing that the best adventures are the ones you share with the people you love. The End.`
  ];

  return pages;
}