import {
  Rule,
  VoiceFeedback,
  VoiceProfile,
  PostSuggestion,
  NetworkPost,
  ConnectedAccount,
  SamplePost,
  UserTopicPreference,
  knex,
} from "#src/models/index.js";

function formatDate(date) {
  if (!date) return "N/A";
  return new Date(date).toISOString().replace("T", " ").substring(0, 19);
}

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

    // ─────────────────────────────────────────────────────────────────────────
    // BIO & CONTEXT (used for persona generation)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${"─".repeat(40)}`);
    console.log("BIO & CONTEXT (inputs for persona)");
    console.log("─".repeat(40));
    const bio = account.bio || {};
    console.log(`  What they do: ${bio.what_you_do || "(not set)"}`);
    console.log(`  Audience: ${bio.audience || "(not set)"}`);
    console.log(`  Perspective: ${bio.perspective || "(not set)"}`);
    console.log(`  Differentiator: ${bio.differentiator || "(not set)"}`);

    // Get curated topics they've selected
    const userTopics = await UserTopicPreference.getUserTopics(userId);
    console.log(`\n  Selected Curated Topics (${userTopics.length}):`);
    if (userTopics.length === 0) {
      console.log(`    (none selected)`);
    } else {
      userTopics.forEach((ut) => {
        console.log(`    - ${ut.curated_topic?.name || ut.curated_topic_id}`);
      });
    }

    // Free-text topics
    console.log(`\n  Free-text Topics: ${account.topics_of_interest || "(not set)"}`);

    // Content preferences
    const prefs = account.content_preferences || {};
    console.log(`\n  Content Preferences:`);
    console.log(`    Line breaks: ${prefs.line_breaks ?? "(not set)"}`);
    console.log(`    Emojis: ${prefs.emojis ?? "(not set)"}`);
    console.log(`    Default length: ${prefs.default_length ?? "(not set)"}`);
    console.log(`    Hashtags: ${prefs.hashtags ?? "(not set)"}`);
    console.log(`    Rotation enabled: ${prefs.rotation_enabled ?? "(not set)"}`);

    // ─────────────────────────────────────────────────────────────────────────
    // SAMPLE POSTS (THE GROUND TRUTH - most important!)
    // ─────────────────────────────────────────────────────────────────────────
    const samplePosts = await SamplePost.query()
      .where("connected_account_id", userId)
      .orderBy("sort_order", "asc")
      .orderBy("created_at", "asc");

    console.log(`\n${"─".repeat(40)}`);
    console.log(`SAMPLE POSTS - GROUND TRUTH (${samplePosts.length} posts)`);
    console.log("─".repeat(40));
    if (samplePosts.length === 0) {
      console.log("  (no sample posts)");
    } else {
      samplePosts.forEach((p, i) => {
        console.log(`\n  [${i + 1}] Created: ${formatDate(p.created_at)}`);
        if (p.notes) {
          console.log(`      Notes: ${p.notes}`);
        }
        console.log(`\n      CONTENT:`);
        console.log(`      ${"─".repeat(30)}`);
        console.log(`      ${p.content.replace(/\n/g, "\n      ")}`);
        console.log(`      ${"─".repeat(30)}`);
      });
    }

    // Load all data for timeline
    const feedback = await VoiceFeedback.query()
      .where("connected_account_id", userId)
      .orderBy("created_at", "desc");

    const allProfiles = await VoiceProfile.query()
      .where("connected_account_id", userId)
      .orderBy("version", "desc");

    const rules = await Rule.query()
      .where("connected_account_id", userId)
      .where("is_active", true)
      .orderBy("created_at", "asc");

    // ─────────────────────────────────────────────────────────────────────────
    // CHRONOLOGICAL TIMELINE (key for debugging!)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${"─".repeat(40)}`);
    console.log("CHRONOLOGICAL TIMELINE");
    console.log("─".repeat(40));

    const timeline = [];

    // Add sample posts to timeline
    samplePosts.forEach((p) => {
      timeline.push({
        time: new Date(p.created_at),
        type: "SAMPLE",
        detail: `Sample post added: "${p.content.substring(0, 50)}..."`,
      });
    });

    // Add rules to timeline
    rules.forEach((r) => {
      timeline.push({
        time: new Date(r.created_at),
        type: "RULE",
        detail: `[${r.rule_type.toUpperCase()}] ${r.content.substring(0, 60)}${r.content.length > 60 ? "..." : ""}`,
      });
    });

    // Add feedback to timeline
    feedback.forEach((f) => {
      timeline.push({
        time: new Date(f.created_at),
        type: "FEEDBACK",
        detail: `[${f.status}] "${f.feedback.substring(0, 50)}..." → v${f.applied_to_version || "pending"}`,
      });
    });

    // Add voice profiles to timeline
    allProfiles.forEach((p) => {
      timeline.push({
        time: new Date(p.created_at),
        type: "PROFILE",
        detail: `v${p.version} [${p.status}] conf=${p.confidence} hash=${p.input_hash || "none"}`,
      });
    });

    // Sort chronologically
    timeline.sort((a, b) => a.time - b.time);

    if (timeline.length === 0) {
      console.log("  (no events)");
    } else {
      timeline.forEach((event) => {
        const typeLabel = event.type.padEnd(8);
        console.log(`  ${formatDate(event.time)} | ${typeLabel} | ${event.detail}`);
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RULES (detailed)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${"─".repeat(40)}`);
    console.log(`RULES (${rules.length} active)`);
    console.log("─".repeat(40));
    if (rules.length === 0) {
      console.log("  (no rules)");
    } else {
      rules.forEach((r, i) => {
        console.log(`\n  [${i + 1}] Type: ${r.rule_type.toUpperCase()} | Priority: ${r.priority} | Created: ${formatDate(r.created_at)}`);
        console.log(`      ${r.content}`);
        if (r.feedback_on_suggestion_id) {
          console.log(`      (from feedback on suggestion: ${r.feedback_on_suggestion_id})`);
        }
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VOICE PROFILE HISTORY
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${"─".repeat(40)}`);
    console.log(`VOICE PROFILE HISTORY (${allProfiles.length} versions)`);
    console.log("─".repeat(40));

    if (allProfiles.length === 0) {
      console.log("  (no voice profiles)");
    } else {
      console.log("\n  VERSION SUMMARY:");
      allProfiles.slice().reverse().forEach((p) => {
        const feedbackApplied = feedback.filter(f => f.applied_to_version === p.version).length;
        console.log(`    v${p.version} | ${p.status.padEnd(10)} | ${formatDate(p.created_at)} | Feedback applied: ${feedbackApplied} | Hash: ${p.input_hash || "none"}`);
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VOICE FEEDBACK (detailed)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${"─".repeat(40)}`);
    console.log(`VOICE FEEDBACK (${feedback.length} total)`);
    console.log("─".repeat(40));

    const pendingFeedback = feedback.filter(f => f.status === "pending");
    const processedFeedback = feedback.filter(f => f.status === "processed");
    const failedFeedback = feedback.filter(f => f.status === "failed");
    console.log(`  Summary: ${processedFeedback.length} processed, ${pendingFeedback.length} pending, ${failedFeedback.length} failed`);

    if (feedback.length === 0) {
      console.log("  (no feedback)");
    } else {
      feedback.forEach((f, i) => {
        console.log(`\n  [${i + 1}] Status: ${f.status} | Applied to: v${f.applied_to_version || "N/A"} | Created: ${formatDate(f.created_at)}`);
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

    // ─────────────────────────────────────────────────────────────────────────
    // LATEST VOICE PROFILE (detailed)
    // ─────────────────────────────────────────────────────────────────────────
    const voiceProfile = allProfiles.find(p => p.status === "active");

    console.log(`\n${"─".repeat(40)}`);
    console.log("LATEST ACTIVE VOICE PROFILE");
    console.log("─".repeat(40));
    if (!voiceProfile) {
      console.log("  (no active voice profile)");
    } else {
      console.log(`\n  Version: ${voiceProfile.version}`);
      console.log(`  Confidence: ${voiceProfile.confidence}`);
      console.log(`  Input Hash: ${voiceProfile.input_hash || "none"}`);
      console.log(`  Created: ${formatDate(voiceProfile.created_at)}`);

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

      // Show generated examples from voice profile
      if (voiceProfile.examples && Object.keys(voiceProfile.examples).length > 0) {
        console.log(`\n  GENERATED EXAMPLES (stored in voice profile):`);
        for (const [key, example] of Object.entries(voiceProfile.examples)) {
          console.log(`\n    ${key.toUpperCase()}:`);
          if (example.prompt) {
            console.log(`      Prompt: ${example.prompt}`);
          }
          if (example.output) {
            console.log(`      Output: ${example.output}`);
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LATEST SUGGESTIONS
    // ─────────────────────────────────────────────────────────────────────────
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
        console.log(`\n  [${i + 1}] Type: ${s.suggestion_type} | Status: ${s.status} | Created: ${formatDate(s.created_at)}`);
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

    // ─────────────────────────────────────────────────────────────────────────
    // NETWORK POSTS (scraped from their account)
    // ─────────────────────────────────────────────────────────────────────────
    const posts = await NetworkPost.query()
      .where("connected_account_id", userId)
      .orderBy("posted_at", "desc")
      .limit(5);

    console.log(`\n${"─".repeat(40)}`);
    console.log("LATEST 5 NETWORK POSTS (scraped, NOT used for voice)");
    console.log("─".repeat(40));
    if (posts.length === 0) {
      console.log("  (no posts scraped)");
    } else {
      posts.forEach((p, i) => {
        console.log(`\n  [${i + 1}] Platform: ${p.platform} | Posted: ${formatDate(p.posted_at)}`);
        console.log(`      Engagement: ${p.like_count} likes, ${p.retweet_count} RTs, ${p.reply_count} replies`);
        console.log(`\n      CONTENT:`);
        console.log(`      ${"─".repeat(30)}`);
        console.log(`      ${p.content.replace(/\n/g, "\n      ")}`);
        console.log(`      ${"─".repeat(30)}`);
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BASIC CHECKS
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${"=".repeat(80)}`);
    console.log("BASIC CHECKS");
    console.log("=".repeat(80));

    const issues = [];

    if (samplePosts.length === 0) {
      issues.push("NO SAMPLE POSTS - Voice profile has no ground truth to learn from.");
    } else if (samplePosts.length < 3) {
      issues.push(`Only ${samplePosts.length} sample post(s). Recommend 3+ for better voice matching.`);
    }

    if (pendingFeedback.length > 0) {
      issues.push(`${pendingFeedback.length} feedback items PENDING - not yet applied to voice profile.`);
    }

    if (failedFeedback.length > 0) {
      issues.push(`${failedFeedback.length} feedback items FAILED.`);
    }

    if (!voiceProfile) {
      issues.push("No active voice profile exists.");
    } else if (voiceProfile.confidence < 0.5) {
      issues.push(`Low confidence (${voiceProfile.confidence}) on voice profile.`);
    }

    // Check if latest profile was created BEFORE latest feedback
    if (voiceProfile && feedback.length > 0) {
      const latestFeedbackTime = new Date(feedback[0].created_at);
      const profileTime = new Date(voiceProfile.created_at);
      if (latestFeedbackTime > profileTime && feedback[0].status === "processed") {
        issues.push(`Latest feedback (${formatDate(latestFeedbackTime)}) was AFTER current profile (${formatDate(profileTime)}) but claims to be processed.`);
      }
    }

    if (issues.length === 0) {
      console.log("\n  No obvious issues detected.");
    } else {
      issues.forEach(issue => console.log(`\n  - ${issue}`));
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
