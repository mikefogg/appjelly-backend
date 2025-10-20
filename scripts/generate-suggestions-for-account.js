#!/usr/bin/env node
/**
 * Manual Suggestion Generation Script
 *
 * Triggers suggestion generation for a specific connected account ID
 *
 * Usage:
 *   npm run script scripts/generate-suggestions-for-account.js <connected_account_id>
 *
 * Or directly:
 *   node scripts/generate-suggestions-for-account.js <connected_account_id>
 *
 * Example:
 *   npm run script scripts/generate-suggestions-for-account.js 123e4567-e89b-12d3-a456-426614174000
 */

import { ghostQueue, JOB_GENERATE_SUGGESTIONS } from "#src/background/queues/index.js";
import { ConnectedAccount } from "#src/models/index.js";

const connectedAccountId = process.argv[2];

if (!connectedAccountId) {
  console.error("❌ Error: Connected account ID is required");
  console.log("\nUsage:");
  console.log("  npm run script scripts/generate-suggestions-for-account.js <connected_account_id>");
  console.log("\nExample:");
  console.log("  npm run script scripts/generate-suggestions-for-account.js 123e4567-e89b-12d3-a456-426614174000");
  process.exit(1);
}

// Validate UUID format
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuidRegex.test(connectedAccountId)) {
  console.error("❌ Error: Invalid UUID format");
  console.log("Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
  process.exit(1);
}

async function generateSuggestionsForAccount() {
  try {
    console.log(`🔍 Looking up connected account: ${connectedAccountId}...`);

    // Verify the connected account exists
    const connectedAccount = await ConnectedAccount.query()
      .findById(connectedAccountId)
      .where("is_active", true);

    if (!connectedAccount) {
      console.error("❌ Error: Connected account not found or is inactive");
      console.log("\nPlease verify:");
      console.log("  1. The UUID is correct");
      console.log("  2. The account exists in the database");
      console.log("  3. The account has is_active = true");
      process.exit(1);
    }

    console.log(`✅ Found account: ${connectedAccount.username} (${connectedAccount.platform})`);

    // Check if account is eligible for suggestion generation
    const isGhostPlatform = connectedAccount.platform === "ghost";

    if (isGhostPlatform) {
      console.log("📝 Ghost platform detected - checking eligibility...");

      const hasTopics = connectedAccount.topics_of_interest && connectedAccount.topics_of_interest.trim().length > 0;

      // Check if we have sample posts
      const { SamplePost } = await import("#src/models/index.js");
      const samplePosts = await SamplePost.query()
        .where("connected_account_id", connectedAccount.id);

      const hasSamples = samplePosts.length > 0;

      if (!hasTopics && !hasSamples) {
        console.error("❌ Error: Ghost account requires either topics_of_interest or sample posts");
        console.log("\nTo fix this, choose one:");
        console.log("  1. Add topics via API: PATCH /connections/:id with 'topics_of_interest' field");
        console.log("  2. Add sample posts via API: POST /connections/:id/samples");
        console.log("\nIf you have sample posts, topics will be auto-generated from them.");
        process.exit(1);
      }

      if (hasTopics) {
        console.log(`✅ Topics: ${connectedAccount.topics_of_interest}`);
      }
      if (hasSamples) {
        console.log(`✅ Sample posts: ${samplePosts.length} found`);
        if (!hasTopics) {
          console.log(`💡 Topics will be inferred from sample posts`);
        }
      }
    } else {
      console.log("🌐 Network platform detected - checking sync status...");

      if (connectedAccount.sync_status !== "ready") {
        console.error(`❌ Error: Account sync_status is '${connectedAccount.sync_status}' (must be 'ready')`);
        console.log("\nTo fix this:");
        console.log("  1. Trigger sync: POST /connections/:id/sync");
        console.log("  2. Wait for sync to complete");
        console.log("  3. Verify status: GET /connections/:id/status");
        process.exit(1);
      }

      console.log("✅ Account is synced and ready");
    }

    // Queue the suggestion generation job
    console.log("\n🚀 Queueing suggestion generation job...");

    const job = await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, {
      connectedAccountId: connectedAccount.id,
      suggestionCount: 3,
      manual: true,
      triggeredBy: "script",
      triggeredAt: new Date().toISOString(),
    });

    console.log(`✅ Job queued successfully!`);
    console.log(`   Job ID: ${job.id}`);
    console.log(`   Connected Account: ${connectedAccount.username}`);
    console.log(`   Platform: ${connectedAccount.platform}`);
    console.log(`   Generation Type: ${isGhostPlatform ? 'Interest-based' : 'Network-based'}`);

    console.log("\n📊 Job will generate 3 suggestions for this account");
    console.log("⏳ Processing time: 10-30 seconds depending on complexity");

    console.log("\n💡 To check job status:");
    console.log("   - View queue in BullMQ dashboard");
    console.log("   - Check suggestions: GET /suggestions?connected_account_id=" + connectedAccountId);

    // Clean up and exit
    await ghostQueue.close();
    process.exit(0);

  } catch (error) {
    console.error("\n❌ Unexpected error:", error.message);
    console.error("\nFull error:", error);
    process.exit(1);
  }
}

// Run the script
generateSuggestionsForAccount();
