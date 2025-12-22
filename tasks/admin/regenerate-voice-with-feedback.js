/**
 * Regenerate voice profiles by queuing the actual jobs
 *
 * This script queues the same jobs that run in production, ensuring
 * 100% parity with the real user flow.
 *
 * Usage:
 *   node tasks/admin/regenerate-voice-with-feedback.js <connected_account_id>
 *   node tasks/admin/regenerate-voice-with-feedback.js <connected_account_id> --create-suggestions
 *   node tasks/admin/regenerate-voice-with-feedback.js --all
 *   node tasks/admin/regenerate-voice-with-feedback.js --all --dry-run
 *   node tasks/admin/regenerate-voice-with-feedback.js --all --create-suggestions
 *
 * Options:
 *   --all                Regenerate for all users with voice profiles and processed feedback
 *   --dry-run            Show what would be done without actually regenerating
 *   --create-suggestions Generate 3 new suggestions after regenerating voice profile
 */

import {
  ConnectedAccount,
  VoiceProfile,
  VoiceFeedback,
  PostSuggestion,
  knex,
} from "#src/models/index.js";
import {
  ghostQueue,
  JOB_GENERATE_VOICE_PROFILE,
  JOB_GENERATE_SUGGESTIONS,
} from "#src/background/queues/index.js";

function formatDate(date) {
  if (!date) return "N/A";
  return new Date(date).toISOString().replace("T", " ").substring(0, 19);
}

async function waitForJob(jobId, maxWaitMs = 120000) {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < maxWaitMs) {
    const job = await ghostQueue.getJob(jobId);
    if (!job) {
      // Job doesn't exist or was removed
      return { success: false, error: "Job not found" };
    }

    const state = await job.getState();
    if (state === "completed") {
      return { success: true, result: job.returnvalue };
    }
    if (state === "failed") {
      return { success: false, error: job.failedReason };
    }

    // Still running, wait and poll again
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return { success: false, error: "Timeout waiting for job" };
}

async function regenerateVoiceProfile(userId, options = {}) {
  const { dryRun = false, createSuggestions = false } = options;
  const account = await ConnectedAccount.query().findById(userId);
  if (!account) {
    console.error(`  ❌ Connected account ${userId} not found`);
    return { success: false, error: "not found" };
  }

  // Get current profile
  const currentProfile = await VoiceProfile.getCurrentProfile(userId);
  if (!currentProfile) {
    console.log(`  ⚠️  No current voice profile - skipping`);
    return { success: false, error: "no profile" };
  }

  // Get processed feedback
  const processedFeedback = await VoiceFeedback.query()
    .where("connected_account_id", userId)
    .where("status", "processed")
    .orderBy("created_at", "asc");

  if (processedFeedback.length === 0) {
    console.log(`  ⚠️  No processed feedback - skipping`);
    return { success: false, error: "no feedback" };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BEFORE
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n  ${"─".repeat(60)}`);
  console.log(`  BEFORE (v${currentProfile.version})`);
  console.log(`  ${"─".repeat(60)}`);
  console.log(`  Voice Summary: ${currentProfile.voice_summary?.substring(0, 200)}...`);
  console.log(`  Persona: ${currentProfile.persona_summary?.substring(0, 200)}...`);
  if (currentProfile.hard_rules?.length > 0) {
    console.log(`  Hard Rules: ${currentProfile.hard_rules.join(", ")}`);
  }

  if (dryRun) {
    console.log(`\n  🔍 DRY RUN - Would regenerate with ${processedFeedback.length} feedback items`);
    console.log(`  Feedback items:`);
    processedFeedback.forEach((f, i) => {
      console.log(`    ${i + 1}. "${f.feedback.substring(0, 80)}..."`);
    });
    return { success: true, dryRun: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // QUEUE VOICE PROFILE REGENERATION JOB
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n  🔄 Queuing voice profile regeneration job...`);

  const voiceJobId = `admin-regen-voice-${userId}-${Date.now()}`;
  await ghostQueue.add(JOB_GENERATE_VOICE_PROFILE, {
    connectedAccountId: userId,
    force: true, // Force regeneration even if inputs unchanged
  }, {
    jobId: voiceJobId,
  });

  console.log(`  ⏳ Waiting for voice profile job to complete...`);
  const voiceResult = await waitForJob(voiceJobId);

  if (!voiceResult.success) {
    console.error(`  ❌ Voice profile job failed: ${voiceResult.error}`);
    return { success: false, error: voiceResult.error };
  }

  console.log(`  ✅ Voice profile job completed`);

  // ─────────────────────────────────────────────────────────────────────────
  // AFTER
  // ─────────────────────────────────────────────────────────────────────────
  const newProfile = await VoiceProfile.getCurrentProfile(userId);

  console.log(`\n  ${"─".repeat(60)}`);
  console.log(`  AFTER (v${newProfile.version})`);
  console.log(`  ${"─".repeat(60)}`);
  console.log(`  Voice Summary: ${newProfile.voice_summary?.substring(0, 200)}...`);
  console.log(`  Persona: ${newProfile.persona_summary?.substring(0, 200)}...`);
  if (newProfile.hard_rules?.length > 0) {
    console.log(`  Hard Rules: ${newProfile.hard_rules.join(", ")}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMPARISON
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n  ${"─".repeat(60)}`);
  console.log(`  COMPARISON`);
  console.log(`  ${"─".repeat(60)}`);

  const voiceSummaryChanged = currentProfile.voice_summary !== newProfile.voice_summary;
  const personaChanged = currentProfile.persona_summary !== newProfile.persona_summary;
  const hardRulesChanged = JSON.stringify(currentProfile.hard_rules) !== JSON.stringify(newProfile.hard_rules);

  console.log(`  Voice Summary Changed: ${voiceSummaryChanged ? "✅ YES" : "❌ NO"}`);
  console.log(`  Persona Changed: ${personaChanged ? "✅ YES" : "❌ NO"}`);
  console.log(`  Hard Rules Changed: ${hardRulesChanged ? "✅ YES" : "❌ NO"}`);

  // Show examples
  if (newProfile.examples && Object.keys(newProfile.examples).length > 0) {
    console.log(`\n  NEW EXAMPLES:`);
    for (const [key, example] of Object.entries(newProfile.examples)) {
      console.log(`    ${key.toUpperCase()}: ${example.output?.substring(0, 100)}...`);
    }
  }

  console.log(`\n  ✅ Successfully created v${newProfile.version}`);

  // ─────────────────────────────────────────────────────────────────────────
  // QUEUE SUGGESTIONS JOB (if requested)
  // ─────────────────────────────────────────────────────────────────────────
  let suggestionsCreated = 0;
  if (createSuggestions) {
    console.log(`\n  ${"─".repeat(60)}`);
    console.log(`  GENERATING NEW SUGGESTIONS`);
    console.log(`  ${"─".repeat(60)}`);

    // Get current suggestion count to compare after
    const beforeCount = await PostSuggestion.query()
      .where("connected_account_id", userId)
      .where("status", "pending")
      .resultSize();

    console.log(`  🔄 Queuing suggestions generation job...`);

    const suggestionsJobId = `admin-regen-suggestions-${userId}-${Date.now()}`;
    await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, {
      connectedAccountId: userId,
      suggestionCount: 3,
    }, {
      jobId: suggestionsJobId,
    });

    console.log(`  ⏳ Waiting for suggestions job to complete...`);
    const suggestionsResult = await waitForJob(suggestionsJobId);

    if (!suggestionsResult.success) {
      console.error(`  ❌ Suggestions job failed: ${suggestionsResult.error}`);
    } else {
      console.log(`  ✅ Suggestions job completed`);

      // Get the new suggestions
      const newSuggestions = await PostSuggestion.query()
        .where("connected_account_id", userId)
        .where("status", "pending")
        .orderBy("created_at", "desc")
        .limit(3);

      suggestionsCreated = newSuggestions.length;

      console.log(`\n  NEW SUGGESTIONS:`);
      newSuggestions.forEach((s, i) => {
        console.log(`\n  [${i + 1}] ${s.content_type || "unknown"} (${s.content?.length} chars)`);
        console.log(`  ${"─".repeat(30)}`);
        console.log(`  ${s.content?.replace(/\n/g, "\n  ")}`);
        console.log(`  ${"─".repeat(30)}`);
      });

      console.log(`\n  ✅ Created ${suggestionsCreated} new suggestions`);
    }
  }

  return {
    success: true,
    oldVersion: currentProfile.version,
    newVersion: newProfile.version,
    changed: voiceSummaryChanged || personaChanged || hardRulesChanged,
    suggestionsCreated,
  };
}

async function regenerateAll(options = {}) {
  const { dryRun = false, createSuggestions = false } = options;
  console.log("=".repeat(80));
  console.log(`REGENERATING VOICE PROFILES${dryRun ? " (DRY RUN)" : ""}${createSuggestions ? " + SUGGESTIONS" : ""}`);
  console.log("=".repeat(80));

  // Find all connected accounts with voice profiles AND processed feedback
  const accountsWithFeedback = await knex.raw(`
    SELECT DISTINCT ca.id, ca.username, ca.platform,
           (SELECT COUNT(*) FROM voice_feedback vf WHERE vf.connected_account_id = ca.id AND vf.status = 'processed') as feedback_count,
           (SELECT MAX(version) FROM voice_profiles vp WHERE vp.connected_account_id = ca.id AND vp.status = 'active') as current_version
    FROM connected_accounts ca
    WHERE EXISTS (
      SELECT 1 FROM voice_profiles vp WHERE vp.connected_account_id = ca.id AND vp.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM voice_feedback vf WHERE vf.connected_account_id = ca.id AND vf.status = 'processed'
    )
    AND ca.is_active = true
    ORDER BY feedback_count DESC
  `);

  const accounts = accountsWithFeedback.rows;
  console.log(`\nFound ${accounts.length} accounts with voice profiles and processed feedback\n`);

  if (accounts.length === 0) {
    console.log("No accounts need regeneration.");
    return;
  }

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  let totalSuggestions = 0;

  for (const account of accounts) {
    console.log(`\n${"═".repeat(80)}`);
    console.log(`Account: ${account.username || account.id}`);
    console.log(`Platform: ${account.platform} | Feedback: ${account.feedback_count} | Current: v${account.current_version}`);
    console.log("═".repeat(80));

    try {
      const result = await regenerateVoiceProfile(account.id, { dryRun, createSuggestions });
      if (result.success) {
        successCount++;
        totalSuggestions += result.suggestionsCreated || 0;
      } else {
        skipCount++;
      }
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      errorCount++;
    }
  }

  console.log(`\n${"═".repeat(80)}`);
  console.log("SUMMARY");
  console.log("═".repeat(80));
  console.log(`  Total accounts: ${accounts.length}`);
  console.log(`  Success: ${successCount}`);
  console.log(`  Skipped: ${skipCount}`);
  console.log(`  Errors: ${errorCount}`);
  if (createSuggestions) {
    console.log(`  Suggestions created: ${totalSuggestions}`);
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const isAll = args.includes("--all");
    const isDryRun = args.includes("--dry-run");
    const createSuggestions = args.includes("--create-suggestions");
    const userId = args.find(arg => !arg.startsWith("--"));

    const options = { dryRun: isDryRun, createSuggestions };

    if (isAll) {
      await regenerateAll(options);
    } else if (userId) {
      console.log("=".repeat(80));
      console.log(`REGENERATING VOICE PROFILE FOR ${userId}${createSuggestions ? " + SUGGESTIONS" : ""}`);
      console.log("=".repeat(80));
      await regenerateVoiceProfile(userId, options);
    } else {
      console.error("Usage:");
      console.error("  node tasks/admin/regenerate-voice-with-feedback.js <connected_account_id>");
      console.error("  node tasks/admin/regenerate-voice-with-feedback.js <connected_account_id> --create-suggestions");
      console.error("  node tasks/admin/regenerate-voice-with-feedback.js --all");
      console.error("  node tasks/admin/regenerate-voice-with-feedback.js --all --dry-run");
      console.error("  node tasks/admin/regenerate-voice-with-feedback.js --all --create-suggestions");
      process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await knex.destroy();
  }
}

main();
