/**
 * Regenerate voice profiles with processed feedback included
 *
 * This script fixes voice profiles that were regenerated without their feedback
 * learnings due to the bug where processed feedback was not included.
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
  SamplePost,
  Rule,
  VoiceProfile,
  VoiceFeedback,
  PostSuggestion,
  Account,
  knex,
} from "#src/models/index.js";
import AI from "#src/services/ai/index.js";
import { v4 as uuidv4 } from "uuid";

function formatDate(date) {
  if (!date) return "N/A";
  return new Date(date).toISOString().replace("T", " ").substring(0, 19);
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

  // Get sample posts and rules
  const [samplePosts, rules] = await Promise.all([
    SamplePost.query()
      .where("connected_account_id", userId)
      .orderBy("sort_order", "asc"),
    Rule.getActiveRules(userId),
  ]);

  if (samplePosts.length === 0) {
    console.log(`  ⚠️  No sample posts - skipping`);
    return { success: false, error: "no samples" };
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
  // REGENERATE
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n  🔄 Regenerating with ${processedFeedback.length} feedback items...`);

  const bio = account.bio || {};
  const contentPrefs = account.getContentPreferences();
  const formatting = {
    line_breaks: contentPrefs.line_breaks || "moderate",
    emojis: contentPrefs.emojis || "none",
  };

  // Combine all feedback
  const allFeedback = processedFeedback.map(f => f.feedback).join("\n");

  // Generate new profile
  const profileData = await AI.generateVoiceProfile({
    samplePosts: samplePosts.map((p) => ({ content: p.content, notes: p.notes })),
    rules: rules.map((r) => ({ rule_type: r.rule_type, content: r.content })),
    feedback: allFeedback,
    topics: account.topics_of_interest,
    bio: bio,
    formatting: formatting,
  });

  // Create new profile version
  const newProfile = await VoiceProfile.query().insert({
    connected_account_id: userId,
    version: currentProfile.version + 1,
    status: "active",
    voice_summary: profileData.voice_summary,
    persona_summary: profileData.persona_summary,
    sentence_patterns: profileData.sentence_patterns,
    vocabulary_notes: profileData.vocabulary_notes,
    tone_markers: profileData.tone_markers,
    formatting_habits: profileData.formatting_habits,
    hard_rules: profileData.hard_rules || [],
    examples: profileData.examples || {},
    confidence: currentProfile.confidence,
    confidence_reasoning: profileData.confidence_reasoning,
    input_hash: currentProfile.input_hash,
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AFTER
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n  ${"─".repeat(60)}`);
  console.log(`  AFTER (v${newProfile.version})`);
  console.log(`  ${"─".repeat(60)}`);
  console.log(`  Voice Summary: ${profileData.voice_summary?.substring(0, 200)}...`);
  console.log(`  Persona: ${profileData.persona_summary?.substring(0, 200)}...`);
  if (profileData.hard_rules?.length > 0) {
    console.log(`  Hard Rules: ${profileData.hard_rules.join(", ")}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMPARISON
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n  ${"─".repeat(60)}`);
  console.log(`  COMPARISON`);
  console.log(`  ${"─".repeat(60)}`);

  const voiceSummaryChanged = currentProfile.voice_summary !== profileData.voice_summary;
  const personaChanged = currentProfile.persona_summary !== profileData.persona_summary;
  const hardRulesChanged = JSON.stringify(currentProfile.hard_rules) !== JSON.stringify(profileData.hard_rules);

  console.log(`  Voice Summary Changed: ${voiceSummaryChanged ? "✅ YES" : "❌ NO"}`);
  console.log(`  Persona Changed: ${personaChanged ? "✅ YES" : "❌ NO"}`);
  console.log(`  Hard Rules Changed: ${hardRulesChanged ? "✅ YES" : "❌ NO"}`);

  // Show examples comparison
  if (profileData.examples) {
    console.log(`\n  NEW EXAMPLES:`);
    for (const [key, example] of Object.entries(profileData.examples)) {
      console.log(`    ${key.toUpperCase()}: ${example.output?.substring(0, 100)}...`);
    }
  }

  console.log(`\n  ✅ Successfully created v${newProfile.version}`);

  // ─────────────────────────────────────────────────────────────────────────
  // GENERATE SUGGESTIONS (if requested)
  // ─────────────────────────────────────────────────────────────────────────
  let suggestionsCreated = 0;
  if (createSuggestions) {
    console.log(`\n  ${"─".repeat(60)}`);
    console.log(`  GENERATING NEW SUGGESTIONS`);
    console.log(`  ${"─".repeat(60)}`);

    // Use the new voice profile for suggestions
    const voiceProfileForAI = {
      voice_summary: profileData.voice_summary,
      persona_summary: profileData.persona_summary,
      sentence_patterns: profileData.sentence_patterns,
      vocabulary_notes: profileData.vocabulary_notes,
      tone_markers: profileData.tone_markers,
      formatting_habits: profileData.formatting_habits,
      hard_rules: profileData.hard_rules || [],
      examples: profileData.examples || {},
    };

    // Determine max length based on platform
    const platformLengths = {
      twitter: 280,
      threads: 500,
      linkedin: 3000,
      instagram: 2200,
      ghost: 280,
    };
    const maxLength = platformLengths[account.platform] || 280;

    console.log(`  Calling AI.generatePosts for ${account.platform} (max ${maxLength} chars)...`);

    try {
      const { posts } = await AI.generatePosts({
        voiceProfile: voiceProfileForAI,
        bio: bio,
        contentTypes: ["story", "hot_take", "insight"],
        platform: account.platform || "ghost",
        maxLength: maxLength,
        count: 3,
        formatting: formatting,
        userRules: rules.map((r) => ({ rule_type: r.rule_type, content: r.content })),
      });

      if (posts && posts.length > 0) {
        // Create a batch ID for these suggestions
        const batchId = uuidv4();

        // Save suggestions to database
        for (const post of posts) {
          await PostSuggestion.query().insert({
            account_id: account.account_id,
            connected_account_id: userId,
            app_id: account.app_id,
            suggestion_type: "original_post",
            content: post.content,
            content_type: post.content_type || null,
            status: "pending",
            batch_id: batchId,
            character_count: post.content?.length || 0,
            metadata: {
              generated_by: "regenerate-voice-with-feedback-script",
              voice_profile_version: newProfile.version,
            },
          });
          suggestionsCreated++;
        }

        console.log(`\n  NEW SUGGESTIONS (saved to database):`);
        posts.forEach((post, i) => {
          console.log(`\n  [${i + 1}] ${post.content_type || "unknown"}`);
          console.log(`  ${"─".repeat(30)}`);
          console.log(`  ${post.content?.replace(/\n/g, "\n  ")}`);
          console.log(`  ${"─".repeat(30)}`);
        });

        console.log(`\n  ✅ Created ${suggestionsCreated} new suggestions`);
      } else {
        console.log(`  ⚠️  No suggestions generated`);
      }
    } catch (error) {
      console.error(`  ❌ Error generating suggestions: ${error.message}`);
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
  console.log(`REGENERATING VOICE PROFILES WITH FEEDBACK${dryRun ? " (DRY RUN)" : ""}${createSuggestions ? " + SUGGESTIONS" : ""}`);
  console.log("=".repeat(80));

  // Find all connected accounts with voice profiles AND processed feedback
  const accountsWithFeedback = await knex.raw(`
    SELECT DISTINCT ca.id, ca.platform_username, ca.platform,
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
    console.log(`Account: ${account.platform_username || account.id}`);
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
