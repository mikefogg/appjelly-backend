/**
 * Test script for different generation modes
 * Tests: generate from topic, improve existing content, batch generation
 *
 * Usage: npm run test:generation-modes
 */

import AI from "../src/services/ai/index.js";

// Shared voice profile for all tests
const voiceProfile = {
  persona_summary: "You are a no-nonsense startup founder who's been through the trenches. You share hard-won lessons about building products and leading teams.",
  voice_summary: "Direct, pragmatic, and experienced. Cuts through the BS. Shares real lessons, not motivational fluff.",
  sentence_patterns: "Short punchy sentences mixed with occasional longer explanatory ones. Uses 'you' to speak directly to readers.",
  tone_markers: "Confident but not arrogant. Battle-tested. Calls out common mistakes. Occasionally self-deprecating.",
  hard_rules: ["Never use corporate buzzwords", "Never be preachy", "Never give vague advice"],
};

const bio = {
  what_you_do: "Founder who's built and sold 2 startups",
  audience: "Other founders and aspiring entrepreneurs",
  perspective: "Most startup advice is BS - here's what actually works",
  differentiator: "I've failed enough to know what not to do",
};

const formatting = {
  line_breaks: "frequent",
  emojis: "none",
};

const userRules = [
  { rule_type: "always", content: "End with a clear, actionable takeaway" },
  { rule_type: "never", content: "Never use the phrase 'game changer'" },
];

// ============ TEST SCENARIOS ============

async function testGenerateFromTopic() {
  console.log("=".repeat(80));
  console.log("TEST 1: GENERATE FROM TOPIC (ideas provided, skips Step 1)");
  console.log("=".repeat(80));
  console.log();
  console.log("Scenario: User provides a topic/prompt, we apply voice and formatting");
  console.log("Topic: 'Why most MVPs fail - it's not about features, it's about validation'");
  console.log("Angle: hot_take");
  console.log();

  const startTime = Date.now();
  const result = await AI.generatePosts({
    voiceProfile,
    bio,
    formatting,
    userRules,
    platform: "twitter",
    maxLength: 280,
    ideas: [
      {
        idea: "Why most MVPs fail - it's not about features, it's about validation. Founders spend months building when they should spend weeks testing. The best MVP is the one that proves your assumption wrong fastest.",
        content_type: "hot_take",
      },
    ],
  });

  const duration = Date.now() - startTime;

  console.log(`Duration: ${duration}ms`);
  console.log(`Model: ${result.usage?.model}`);
  console.log(`Tokens: ${result.usage?.total_tokens}`);
  console.log();
  console.log("--- OUTPUT ---");
  console.log();
  console.log(result.posts[0].content);
  console.log();
  console.log(`Characters: ${result.posts[0].content.length}`);
  console.log(`Line breaks: ${(result.posts[0].content.match(/\n\n/g) || []).length}`);
  console.log();

  return result;
}

async function testImproveExisting() {
  console.log("=".repeat(80));
  console.log("TEST 2: IMPROVE EXISTING CONTENT (ideas provided, skips Step 1)");
  console.log("=".repeat(80));
  console.log();
  console.log("Scenario: User has existing content, we improve it with voice and formatting");
  console.log();

  const originalContent = `Most startups fail because founders build what they think users want instead of testing assumptions first. Stop building features. Start validating ideas. Your MVP should be embarrassingly simple.`;

  console.log("--- ORIGINAL CONTENT ---");
  console.log(originalContent);
  console.log();

  const startTime = Date.now();
  const result = await AI.generatePosts({
    voiceProfile,
    bio,
    formatting,
    userRules,
    platform: "twitter",
    maxLength: 280,
    ideas: [
      {
        idea: `Improve this post while keeping the core message:\n\n${originalContent}`,
        content_type: "improvement",
      },
    ],
  });

  const duration = Date.now() - startTime;

  console.log(`Duration: ${duration}ms`);
  console.log(`Model: ${result.usage?.model}`);
  console.log(`Tokens: ${result.usage?.total_tokens}`);
  console.log();
  console.log("--- IMPROVED OUTPUT ---");
  console.log();
  console.log(result.posts[0].content);
  console.log();
  console.log(`Characters: ${result.posts[0].content.length}`);
  console.log(`Line breaks: ${(result.posts[0].content.match(/\n\n/g) || []).length}`);
  console.log();

  return result;
}

async function testBatchGeneration() {
  console.log("=".repeat(80));
  console.log("TEST 3: BATCH GENERATION (no ideas, runs both steps)");
  console.log("=".repeat(80));
  console.log();
  console.log("Scenario: No topic provided, AI generates ideas then formats them");
  console.log("Content types: hot_take, story, insight");
  console.log();

  const startTime = Date.now();
  const result = await AI.generatePosts({
    voiceProfile,
    bio,
    formatting,
    userRules,
    platform: "twitter",
    maxLength: 280,
    count: 3,
    contentTypes: ["hot_take", "story", "insight"],
    // No ideas provided - will run Step 1
  });

  const duration = Date.now() - startTime;

  console.log();
  console.log(`Duration: ${duration}ms`);
  console.log(`Model: ${result.usage?.model}`);
  console.log(`Tokens: ${result.usage?.total_tokens}`);
  console.log();

  result.posts.forEach((post, i) => {
    console.log(`--- POST ${i + 1} [${post.content_type}] ---`);
    console.log();
    console.log(post.content);
    console.log();
    console.log(`Characters: ${post.content.length}`);
    console.log(`Line breaks: ${(post.content.match(/\n\n/g) || []).length}`);
    console.log();
  });

  return result;
}

// ============ RUN ALL TESTS ============

async function runTests() {
  console.log("=".repeat(80));
  console.log("GENERATION MODES TEST");
  console.log("=".repeat(80));
  console.log();
  console.log("Voice: Direct startup founder, no BS, frequent line breaks, no emojis");
  console.log("Rules: Must end with actionable takeaway, never say 'game changer'");
  console.log();

  try {
    await testGenerateFromTopic();
    await testImproveExisting();
    await testBatchGeneration();

    console.log("=".repeat(80));
    console.log("ALL TESTS COMPLETE");
    console.log("=".repeat(80));
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

runTests().then(() => process.exit(0)).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
