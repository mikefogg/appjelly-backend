import {
  Rule,
  VoiceFeedback,
  VoiceProfile,
  PostSuggestion,
  NetworkPost,
  ConnectedAccount,
  knex,
} from "#src/models/index.js";

async function analyzeUserAI(userId) {
  try {
    // Find the connected account
    const account = await ConnectedAccount.query().findById(userId);
    if (!account) {
      console.error(`Error: Connected account ${userId} not found`);
      process.exit(1);
    }

    console.log("=".repeat(80));
    console.log(`AI QUALITY ANALYSIS FOR: ${account.platform_username || account.id}`);
    console.log(`Platform: ${account.platform}`);
    console.log("=".repeat(80));

    // 1. Get all active rules
    const rules = await Rule.query()
      .where("connected_account_id", userId)
      .where("is_active", true)
      .orderBy("priority", "desc")
      .orderBy("created_at", "asc");

    console.log(`\n${"─".repeat(40)}`);
    console.log(`RULES (${rules.length} active)`);
    console.log("─".repeat(40));
    if (rules.length === 0) {
      console.log("  (no rules)");
    } else {
      rules.forEach((r, i) => {
        console.log(`\n  [${i + 1}] Type: ${r.rule_type.toUpperCase()} | Priority: ${r.priority}`);
        console.log(`      ${r.content}`);
        if (r.feedback_on_suggestion_id) {
          console.log(`      (from feedback on suggestion: ${r.feedback_on_suggestion_id})`);
        }
      });
    }

    // 2. Get all feedback
    const feedback = await VoiceFeedback.query()
      .where("connected_account_id", userId)
      .orderBy("created_at", "desc");

    console.log(`\n${"─".repeat(40)}`);
    console.log(`VOICE FEEDBACK (${feedback.length} total)`);
    console.log("─".repeat(40));
    if (feedback.length === 0) {
      console.log("  (no feedback)");
    } else {
      feedback.forEach((f, i) => {
        console.log(`\n  [${i + 1}] Status: ${f.status} | Created: ${f.created_at}`);
        console.log(`      Feedback: "${f.feedback}"`);
        if (f.reference_text) {
          console.log(`      Reference: "${f.reference_text.substring(0, 100)}${f.reference_text.length > 100 ? "..." : ""}"`);
        }
        if (f.ai_reasoning) {
          console.log(`      AI Reasoning: ${f.ai_reasoning}`);
        }
        if (f.failed_reason) {
          console.log(`      Failed Reason: ${f.failed_reason}`);
        }
      });
    }

    // 3. Get latest voice profile
    const voiceProfile = await VoiceProfile.query()
      .where("connected_account_id", userId)
      .where("status", "active")
      .orderBy("version", "desc")
      .first();

    console.log(`\n${"─".repeat(40)}`);
    console.log("LATEST VOICE PROFILE");
    console.log("─".repeat(40));
    if (!voiceProfile) {
      console.log("  (no active voice profile)");
    } else {
      console.log(`\n  Version: ${voiceProfile.version}`);
      console.log(`  Confidence: ${voiceProfile.confidence}`);
      console.log(`  Created: ${voiceProfile.created_at}`);

      if (voiceProfile.voice_summary) {
        console.log(`\n  Voice Summary:\n    ${voiceProfile.voice_summary.replace(/\n/g, "\n    ")}`);
      }
      if (voiceProfile.persona_summary) {
        console.log(`\n  Persona Summary:\n    ${voiceProfile.persona_summary.replace(/\n/g, "\n    ")}`);
      }
      if (voiceProfile.sentence_patterns) {
        console.log(`\n  Sentence Patterns:\n    ${voiceProfile.sentence_patterns.replace(/\n/g, "\n    ")}`);
      }
      if (voiceProfile.vocabulary_notes) {
        console.log(`\n  Vocabulary Notes:\n    ${voiceProfile.vocabulary_notes.replace(/\n/g, "\n    ")}`);
      }
      if (voiceProfile.tone_markers) {
        console.log(`\n  Tone Markers:\n    ${voiceProfile.tone_markers.replace(/\n/g, "\n    ")}`);
      }
      if (voiceProfile.formatting_habits) {
        console.log(`\n  Formatting Habits:\n    ${voiceProfile.formatting_habits.replace(/\n/g, "\n    ")}`);
      }
      if (voiceProfile.hard_rules && voiceProfile.hard_rules.length > 0) {
        console.log(`\n  Hard Rules:`);
        voiceProfile.hard_rules.forEach((rule, i) => {
          console.log(`    ${i + 1}. ${rule}`);
        });
      }
      if (voiceProfile.confidence_reasoning) {
        console.log(`\n  Confidence Reasoning:\n    ${voiceProfile.confidence_reasoning.replace(/\n/g, "\n    ")}`);
      }
    }

    // 4. Get latest 3 suggestions
    const suggestions = await PostSuggestion.query()
      .where("connected_account_id", userId)
      .orderBy("created_at", "desc")
      .limit(3);

    console.log(`\n${"─".repeat(40)}`);
    console.log("LATEST 3 SUGGESTIONS");
    console.log("─".repeat(40));
    if (suggestions.length === 0) {
      console.log("  (no suggestions)");
    } else {
      suggestions.forEach((s, i) => {
        console.log(`\n  [${i + 1}] Type: ${s.suggestion_type} | Status: ${s.status} | Created: ${s.created_at}`);
        if (s.angle) console.log(`      Angle: ${s.angle} | Length: ${s.length} | Content Type: ${s.content_type}`);
        console.log(`\n      CONTENT:`);
        console.log(`      ${"─".repeat(30)}`);
        console.log(`      ${s.content.replace(/\n/g, "\n      ")}`);
        console.log(`      ${"─".repeat(30)}`);
        if (s.reasoning) {
          console.log(`\n      Reasoning: ${s.reasoning}`);
        }
        if (s.topics && s.topics.length > 0) {
          console.log(`      Topics: ${s.topics.join(", ")}`);
        }
      });
    }

    // 5. Get latest 5 posts (user's actual posts for comparison)
    const posts = await NetworkPost.query()
      .where("connected_account_id", userId)
      .orderBy("posted_at", "desc")
      .limit(5);

    console.log(`\n${"─".repeat(40)}`);
    console.log("LATEST 5 POSTS (for voice comparison)");
    console.log("─".repeat(40));
    if (posts.length === 0) {
      console.log("  (no posts)");
    } else {
      posts.forEach((p, i) => {
        console.log(`\n  [${i + 1}] Platform: ${p.platform} | Posted: ${p.posted_at}`);
        console.log(`      Engagement: ${p.like_count} likes, ${p.retweet_count} RTs, ${p.reply_count} replies`);
        console.log(`\n      CONTENT:`);
        console.log(`      ${"─".repeat(30)}`);
        console.log(`      ${p.content.replace(/\n/g, "\n      ")}`);
        console.log(`      ${"─".repeat(30)}`);
        if (p.topics && p.topics.length > 0) {
          console.log(`      Topics: ${p.topics.join(", ")}`);
        }
      });
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("END OF ANALYSIS");
    console.log("=".repeat(80));

  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await knex.destroy();
  }
}

// Run with: node tasks/admin/analyze-user-ai.js <userId>
const userId = process.argv[2];
if (!userId) {
  console.error("Usage: node tasks/admin/analyze-user-ai.js <connected_account_id>");
  console.error("\nExample: node tasks/admin/analyze-user-ai.js abc123-def456-...");
  process.exit(1);
}

analyzeUserAI(userId);
