/**
 * Model Comparison Test
 * Compares different model configurations for post generation
 *
 * Usage: npm run compare-models
 */

import AI from "../src/services/ai/index.js";

// Test profile with user rules for comprehensive testing
const testProfile = {
  name: "Fitness Coach with User Rules",
  voiceProfile: {
    persona_summary: "You are an energetic fitness coach who motivates people to move their bodies and feel strong. You focus on sustainable habits over quick fixes.",
    voice_summary: "Motivational, energetic, and supportive. Uses action words. Gets people pumped without being over the top.",
    sentence_patterns: "Mix of short punchy motivational lines and practical advice. Direct calls to action.",
    tone_markers: "Encouraging, confident, relatable. Understands the struggle but pushes through it.",
    hard_rules: ["Never promote crash diets", "Never body shame"],
  },
  bio: {
    what_you_do: "Fitness coach helping busy people build sustainable workout habits",
    audience: "Busy professionals who want to get fit without living at the gym",
    perspective: "Fitness should fit your life, not take it over",
    differentiator: "Real results with 30-minute workouts",
  },
  formatting: {
    line_breaks: "moderate",
    emojis: "heavy",
  },
  contentTypes: ["hot_take", "insight", "story"],
  userRules: [
    { rule_type: "always", content: "End every post with 'Let's go!' or 'You got this!'" },
    { rule_type: "always", content: "Include the hashtag #FitLife" },
    { rule_type: "never", content: "Never use the word 'grind' or 'hustle'" },
    { rule_type: "never", content: "Never mention specific calorie counts" },
    { rule_type: "prefer", content: "Use 'strength' over 'skinny'" },
    { rule_type: "tone", content: "Be encouraging, not drill-sergeant aggressive" },
  ],
};

// Model configurations to compare
const modelConfigs = [
  { version: "v2-4o-aug", label: "4o-Aug + 4o-Aug", description: "GPT-4o August 2024 for both steps" },
  { version: "v2-4o-nov", label: "4o-Nov + 4o-Nov", description: "GPT-4o November 2024 for both steps" },
  { version: "v2-4o-aug-41", label: "4o-Aug + 4.1", description: "GPT-4o August 2024 + GPT-4.1" },
  { version: "v2-4o-nov-41", label: "4o-Nov + 4.1", description: "GPT-4o November 2024 + GPT-4.1" },
];

// Scoring function for rule compliance
function scorePost(post, userRules) {
  const scores = {
    always: { total: 0, passed: 0, details: [] },
    never: { total: 0, passed: 0, details: [] },
    formatting: { lineBreaks: 0, emojis: 0 },
  };

  const content = post.content.toLowerCase();

  // Check ALWAYS rules
  const alwaysRules = userRules.filter(r => r.rule_type === "always");
  scores.always.total = alwaysRules.length;
  for (const rule of alwaysRules) {
    let passed = false;
    if (rule.content.includes("Let's go") || rule.content.includes("You got this")) {
      passed = content.includes("let's go") || content.includes("you got this");
    } else if (rule.content.includes("#FitLife")) {
      passed = post.content.includes("#FitLife");
    }
    if (passed) scores.always.passed++;
    scores.always.details.push({ rule: rule.content, passed });
  }

  // Check NEVER rules
  const neverRules = userRules.filter(r => r.rule_type === "never");
  scores.never.total = neverRules.length;
  for (const rule of neverRules) {
    let passed = true;
    if (rule.content.includes("grind") || rule.content.includes("hustle")) {
      passed = !content.includes("grind") && !content.includes("hustle");
    } else if (rule.content.includes("calorie")) {
      passed = !content.match(/\d+\s*calorie/i);
    }
    if (passed) scores.never.passed++;
    scores.never.details.push({ rule: rule.content, passed });
  }

  // Count formatting
  scores.formatting.lineBreaks = (post.content.match(/\n\n/g) || []).length;
  scores.formatting.emojis = (post.content.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;

  return scores;
}

async function runComparison() {
  console.log("=".repeat(80));
  console.log("MODEL COMPARISON TEST");
  console.log("=".repeat(80));
  console.log();
  console.log("Testing with: Fitness Coach profile (has user rules for compliance testing)");
  console.log();

  const results = [];

  for (const config of modelConfigs) {
    console.log("=".repeat(80));
    console.log(`CONFIG: ${config.label}`);
    console.log(`${config.description}`);
    console.log("=".repeat(80));
    console.log();

    try {
      const startTime = Date.now();

      const result = await AI.generatePosts({
        voiceProfile: testProfile.voiceProfile,
        bio: testProfile.bio,
        contentTypes: testProfile.contentTypes,
        platform: "twitter",
        maxLength: 280,
        count: 3,
        formatting: testProfile.formatting,
        userRules: testProfile.userRules,
        promptVersion: config.version,
      });

      const duration = Date.now() - startTime;

      // Score each post
      const postScores = result.posts.map(post => scorePost(post, testProfile.userRules));

      // Aggregate scores
      const totalAlwaysRules = postScores.reduce((sum, s) => sum + s.always.total, 0);
      const passedAlwaysRules = postScores.reduce((sum, s) => sum + s.always.passed, 0);
      const totalNeverRules = postScores.reduce((sum, s) => sum + s.never.total, 0);
      const passedNeverRules = postScores.reduce((sum, s) => sum + s.never.passed, 0);
      const avgLineBreaks = postScores.reduce((sum, s) => sum + s.formatting.lineBreaks, 0) / 3;
      const avgEmojis = postScores.reduce((sum, s) => sum + s.formatting.emojis, 0) / 3;

      const configResult = {
        config: config.label,
        duration,
        model: result.usage?.model,
        tokens: result.usage?.total_tokens,
        alwaysScore: `${passedAlwaysRules}/${totalAlwaysRules}`,
        neverScore: `${passedNeverRules}/${totalNeverRules}`,
        avgLineBreaks: avgLineBreaks.toFixed(1),
        avgEmojis: avgEmojis.toFixed(1),
        posts: result.posts,
      };
      results.push(configResult);

      console.log(`Duration: ${duration}ms | Tokens: ${result.usage?.total_tokens}`);
      console.log(`ALWAYS rules: ${passedAlwaysRules}/${totalAlwaysRules} | NEVER rules: ${passedNeverRules}/${totalNeverRules}`);
      console.log(`Avg Line Breaks: ${avgLineBreaks.toFixed(1)} | Avg Emojis: ${avgEmojis.toFixed(1)}`);
      console.log();

      result.posts.forEach((post, i) => {
        const score = postScores[i];
        console.log(`--- POST ${i + 1} [${post.content_type}] ---`);
        console.log(post.content);
        console.log();
        console.log(`ALWAYS: ${score.always.details.map(d => d.passed ? "✅" : "❌").join(" ")} | NEVER: ${score.never.details.map(d => d.passed ? "✅" : "❌").join(" ")}`);
        console.log(`Line breaks: ${score.formatting.lineBreaks} | Emojis: ${score.formatting.emojis}`);
        console.log();
      });

    } catch (error) {
      console.error(`ERROR: ${error.message}`);
      console.error(error.stack);
      results.push({
        config: config.label,
        error: error.message,
      });
    }

    console.log();
  }

  // Summary table
  console.log("=".repeat(80));
  console.log("SUMMARY COMPARISON");
  console.log("=".repeat(80));
  console.log();
  console.log("Config             | Duration | Tokens | ALWAYS | NEVER | LineBreaks | Emojis");
  console.log("-".repeat(80));
  for (const r of results) {
    if (r.error) {
      console.log(`${r.config.padEnd(18)} | ERROR: ${r.error}`);
    } else {
      console.log(
        `${r.config.padEnd(18)} | ${String(r.duration + "ms").padEnd(8)} | ${String(r.tokens).padEnd(6)} | ${r.alwaysScore.padEnd(6)} | ${r.neverScore.padEnd(5)} | ${r.avgLineBreaks.padEnd(10)} | ${r.avgEmojis}`
      );
    }
  }
  console.log();
  console.log("Expected: ALWAYS 6/6, NEVER 6/6, LineBreaks ~2, Emojis ~4-5 (heavy)");
  console.log();
}

runComparison().then(() => process.exit(0)).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
