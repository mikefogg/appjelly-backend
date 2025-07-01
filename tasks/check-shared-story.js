#!/usr/bin/env node

/**
 * Check actors in a shared story by token
 * 
 * Usage:
 *   dev node tasks/check-shared-story.js [token]
 */

import { SharedView, Actor, ArtifactActor } from "#src/models/index.js";

const token = process.argv[2] || "share_test_family7_1751289542659";

console.log(`🔍 Checking shared story: ${token}\n`);

try {
  const sharedView = await SharedView.findByToken(token);
  
  if (!sharedView) {
    console.error("❌ Shared view not found");
    process.exit(1);
  }

  console.log(`📖 Story: "${sharedView.artifact.title}"`);
  console.log(`🔗 Token: ${sharedView.token}`);
  console.log(`✅ Claiming enabled: ${sharedView.permissions.can_claim_characters}`);

  // Get all actors in the story
  const artifactActors = await ArtifactActor.query()
    .where("artifact_id", sharedView.artifact.id)
    .withGraphFetched("[actor]");

  console.log(`\n🎭 Actors in story (${artifactActors.length}):`);
  
  for (const aa of artifactActors) {
    const actor = aa.actor;
    console.log(`  - ${actor.name} (${actor.type})`);
    console.log(`    🔓 Claimable: ${actor.is_claimable}`);
    console.log(`    🌟 Main character: ${aa.is_main_character}`);
    console.log(`    👤 Owner: ${actor.account_id}`);
    console.log();
  }

  const claimableCount = artifactActors.filter(aa => aa.actor.is_claimable).length;
  console.log(`📊 Summary: ${claimableCount} claimable actors out of ${artifactActors.length} total`);

  process.exit(0);
} catch (error) {
  console.error("❌ Error checking shared story:", error.message);
  process.exit(1);
}