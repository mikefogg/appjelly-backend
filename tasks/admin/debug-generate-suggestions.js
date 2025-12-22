/**
 * Debug script to preview AI-generated suggestions without saving
 *
 * Usage:
 *   node tasks/admin/debug-generate-suggestions.js <connected_account_id>
 *   node tasks/admin/debug-generate-suggestions.js <connected_account_id> --refresh-voice
 *
 * Options:
 *   --refresh-voice    Regenerate voice profile first (without saving)
 */

import {
  ConnectedAccount,
  SamplePost,
  Rule,
  VoiceProfile,
  UserTopicPreference,
  knex,
} from "#src/models/index.js";
import AI from "#src/services/ai/index.js";

function formatDate(date) {
  if (!date) return "N/A";
  return new Date(date).toISOString().replace("T", " ").substring(0, 19);
}

async function debugGenerateSuggestions(userId, refreshVoice = false) {
  try {
    // ─────────────────────────────────────────────────────────────────────────
    // LOAD ACCOUNT DATA
    // ─────────────────────────────────────────────────────────────────────────
    const account = await ConnectedAccount.query().findById(userId);
    if (!account) {
      console.error(`Error: Connected account ${userId} not found`);
      process.exit(1);
    }

    console.log("=".repeat(80));
    console.log(`DEBUG SUGGESTION GENERATION`);
    console.log(`Account: ${account.platform_username || account.id}`);
    console.log(`Platform: ${account.platform}`);
    console.log(`Refresh Voice: ${refreshVoice}`);
    console.log("=".repeat(80));

    // Load all the inputs
    const [samplePosts, rules, currentProfile, userTopics] = await Promise.all([
      SamplePost.query()
        .where("connected_account_id", userId)
        .orderBy("sort_order", "asc"),
      Rule.getActiveRules(userId),
      VoiceProfile.getCurrentProfile(userId),
      UserTopicPreference.getUserTopics(userId),
    ]);

    const bio = account.bio || {};
    const contentPrefs = account.getContentPreferences();
    const formatting = {
      line_breaks: contentPrefs.line_breaks || "moderate",
      emojis: contentPrefs.emojis || "none",
    };

    console.log(`\n${"─".repeat(40)}`);
    console.log("INPUTS SUMMARY");
    console.log("─".repeat(40));
    console.log(`  Sample posts: ${samplePosts.length}`);
    console.log(`  Rules: ${rules.length}`);
    console.log(`  Current voice profile: ${currentProfile ? `v${currentProfile.version}` : "none"}`);
    console.log(`  Curated topics: ${userTopics.length}`);
    console.log(`  Bio set: ${bio.what_you_do ? "yes" : "no"}`);
    console.log(`  Formatting: line_breaks=${formatting.line_breaks}, emojis=${formatting.emojis}`);

    // ─────────────────────────────────────────────────────────────────────────
    // VOICE PROFILE (refresh or use existing)
    // ─────────────────────────────────────────────────────────────────────────
    let voiceProfileForAI = null;

    if (refreshVoice) {
      console.log(`\n${"─".repeat(40)}`);
      console.log("REGENERATING VOICE PROFILE (not saving)");
      console.log("─".repeat(40));

      if (samplePosts.length === 0) {
        console.log("  ⚠️  No sample posts - cannot generate voice profile");
        console.log("  Using bio-only fallback for suggestions...");
      } else {
        console.log(`  Calling AI.generateVoiceProfile with ${samplePosts.length} samples...`);

        const profileData = await AI.generateVoiceProfile({
          samplePosts: samplePosts.map((p) => ({ content: p.content, notes: p.notes })),
          rules: rules.map((r) => ({ rule_type: r.rule_type, content: r.content })),
          feedback: null,
          topics: account.topics_of_interest,
          bio: bio,
          formatting: formatting,
        });

        voiceProfileForAI = {
          voice_summary: profileData.voice_summary,
          persona_summary: profileData.persona_summary,
          sentence_patterns: profileData.sentence_patterns,
          vocabulary_notes: profileData.vocabulary_notes,
          tone_markers: profileData.tone_markers,
          formatting_habits: profileData.formatting_habits,
          hard_rules: profileData.hard_rules || [],
          examples: profileData.examples || {},
        };

        console.log(`\n  ✅ Voice profile generated (NOT SAVED)`);
        console.log(`\n  Voice Summary:\n    ${profileData.voice_summary?.replace(/\n/g, "\n    ") || "(none)"}`);
        console.log(`\n  Persona Summary:\n    ${profileData.persona_summary?.replace(/\n/g, "\n    ") || "(none)"}`);
        console.log(`\n  Sentence Patterns:\n    ${profileData.sentence_patterns?.replace(/\n/g, "\n    ") || "(none)"}`);
        console.log(`\n  Vocabulary Notes:\n    ${profileData.vocabulary_notes?.replace(/\n/g, "\n    ") || "(none)"}`);
        console.log(`\n  Tone Markers:\n    ${profileData.tone_markers?.replace(/\n/g, "\n    ") || "(none)"}`);
        console.log(`\n  Formatting Habits:\n    ${profileData.formatting_habits?.replace(/\n/g, "\n    ") || "(none)"}`);
        if (profileData.hard_rules && profileData.hard_rules.length > 0) {
          console.log(`\n  Hard Rules:`);
          profileData.hard_rules.forEach((rule, i) => {
            console.log(`    ${i + 1}. ${rule}`);
          });
        }

        // Show generated examples
        if (profileData.examples && Object.keys(profileData.examples).length > 0) {
          console.log(`\n  Generated Examples:`);
          for (const [key, example] of Object.entries(profileData.examples)) {
            console.log(`\n    ${key.toUpperCase()}:`);
            if (example.output) {
              console.log(`      ${example.output}`);
            }
          }
        }
      }
    } else {
      // Use existing voice profile
      if (currentProfile) {
        voiceProfileForAI = currentProfile.toPromptFormat();
        console.log(`\n  Using existing voice profile v${currentProfile.version}`);
      } else {
        console.log(`\n  ⚠️  No existing voice profile - using bio-only fallback`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GENERATE SUGGESTIONS (not saving)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${"─".repeat(40)}`);
    console.log("GENERATING 3 SUGGESTIONS (not saving)");
    console.log("─".repeat(40));

    // Determine max length based on platform
    const platformLengths = {
      twitter: 280,
      threads: 500,
      linkedin: 3000,
      instagram: 2200,
      ghost: 280, // Default for ghost platform
    };
    const maxLength = platformLengths[account.platform] || 280;

    console.log(`  Platform: ${account.platform}`);
    console.log(`  Max length: ${maxLength}`);
    console.log(`  Content types: story, hot_take, insight`);
    console.log(`  Calling AI.generatePosts...`);

    const { posts, usages } = await AI.generatePosts({
      voiceProfile: voiceProfileForAI,
      bio: bio,
      contentTypes: ["story", "hot_take", "insight"],
      platform: account.platform || "ghost",
      maxLength: maxLength,
      count: 3,
      formatting: formatting,
      userRules: rules.map((r) => ({ rule_type: r.rule_type, content: r.content })),
    });

    // ─────────────────────────────────────────────────────────────────────────
    // OUTPUT RESULTS
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${"=".repeat(80)}`);
    console.log("GENERATED SUGGESTIONS (NOT SAVED)");
    console.log("=".repeat(80));

    if (!posts || posts.length === 0) {
      console.log("\n  ❌ No posts generated!");
    } else {
      posts.forEach((post, i) => {
        console.log(`\n${"─".repeat(40)}`);
        console.log(`SUGGESTION ${i + 1}`);
        console.log("─".repeat(40));
        console.log(`  Content Type: ${post.content_type || "unknown"}`);
        console.log(`  Character Count: ${post.content?.length || 0}`);
        console.log(`\n  CONTENT:`);
        console.log(`  ${"─".repeat(30)}`);
        console.log(`  ${post.content?.replace(/\n/g, "\n  ") || "(empty)"}`);
        console.log(`  ${"─".repeat(30)}`);
      });
    }

    // Show token usage
    if (usages && usages.length > 0) {
      console.log(`\n${"─".repeat(40)}`);
      console.log("AI USAGE");
      console.log("─".repeat(40));
      usages.forEach((usage, i) => {
        console.log(`  [${i + 1}] ${usage.operation}: ${usage.model} - ${usage.input_tokens} in / ${usage.output_tokens} out (${usage.duration_ms}ms)`);
      });
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("END OF DEBUG OUTPUT");
    console.log("=".repeat(80));
    console.log("\n⚠️  Nothing was saved to the database. This was a dry run.\n");

  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await knex.destroy();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const userId = args.find(arg => !arg.startsWith("--"));
const refreshVoice = args.includes("--refresh-voice");

if (!userId) {
  console.error("Usage: node tasks/admin/debug-generate-suggestions.js <connected_account_id> [--refresh-voice]");
  console.error("\nOptions:");
  console.error("  --refresh-voice    Regenerate voice profile first (without saving)");
  console.error("\nExample:");
  console.error("  node tasks/admin/debug-generate-suggestions.js abc123-def456");
  console.error("  node tasks/admin/debug-generate-suggestions.js abc123-def456 --refresh-voice");
  process.exit(1);
}

debugGenerateSuggestions(userId, refreshVoice);
