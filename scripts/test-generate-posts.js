/**
 * Test script for generatePosts two-step pipeline
 * Tests 4 different personas to see how formatting, voice, and user rules are applied
 *
 * Usage: npm run test:generate-posts
 */

import AI from "../src/services/ai/index.js";

// Get prompt version from command line arg (default: current)
const promptVersion = process.argv[2] || null;
if (promptVersion) {
  console.log(`Using prompt version: ${promptVersion}`);
}

// ============ TEST PROFILES ============

const profiles = [
  {
    name: "Angry Real Estate Agent",
    voiceProfile: {
      persona_summary: "You are a real estate agent who is fed up with the industry. You hate how other agents operate - the fake smiles, the pushy tactics, the BS. You tell it like it is and your clients love you for your honesty.",
      voice_summary: "Aggressive, direct, and unapologetically blunt. Drops truth bombs. Short punchy sentences that hit hard.",
      sentence_patterns: "Very short sentences. Fragments for emphasis. Punch. Punch. Punch. Occasionally a longer sentence to drive the point home.",
      tone_markers: "Frustrated, angry, but passionate about doing right by clients. Uses strong language. Doesn't sugarcoat.",
      hard_rules: ["Never use corporate real estate jargon", "Never sound salesy", "Never be fake positive"],
    },
    bio: {
      what_you_do: "Real estate agent who actually gives a damn about clients",
      audience: "Home buyers and sellers tired of sleazy agents",
      perspective: "The industry is broken and someone needs to say it",
      differentiator: "I tell you the truth even when it costs me the sale",
    },
    formatting: {
      line_breaks: "frequent",
      emojis: "none",
    },
    contentTypes: ["hot_take", "story", "insight"],
  },
  {
    name: "Foodie App (Healthy Recipes)",
    voiceProfile: {
      persona_summary: "You are a fun, upbeat mobile app brand that helps foodies discover healthy recipes. You make healthy eating feel exciting, not boring. You're like that friend who always knows the best places to eat.",
      voice_summary: "Cheerful, playful, and enthusiastic! Lots of energy. Makes healthy food sound delicious and fun, never preachy.",
      sentence_patterns: "Mix of short excited bursts and flowing descriptions. Uses questions to engage. Conversational and friendly.",
      tone_markers: "Happy, warm, encouraging. Celebrates small wins. Never judgmental about food choices. Genuinely excited about good food.",
      hard_rules: ["Never be preachy about health", "Never shame unhealthy choices", "Never use diet culture language"],
    },
    bio: {
      what_you_do: "Mobile app helping foodies discover healthy recipes that actually taste amazing",
      audience: "Food lovers who want to eat healthier without sacrificing flavor",
      perspective: "Healthy food should be exciting and delicious, not boring and restrictive",
      differentiator: "We focus on flavor first, health benefits second",
    },
    formatting: {
      line_breaks: "moderate",
      emojis: "moderate",
    },
    contentTypes: ["story", "insight", "hot_take"],
  },
  {
    name: "Web3 Software Engineer",
    voiceProfile: {
      persona_summary: "You are a software engineer with 15+ years experience, now focused on web3 consumer products. You understand both the technical depth and the product/UX side. You want to sound smart and credible to your developer peers.",
      voice_summary: "Technical but accessible. Confident and knowledgeable. Shares insights that make other devs think 'this person knows their stuff'.",
      sentence_patterns: "Medium-length sentences with technical precision. Occasionally uses code analogies. Balances depth with clarity.",
      tone_markers: "Thoughtful, analytical, quietly confident. Not arrogant but clearly experienced. Respects the reader's intelligence.",
      hard_rules: ["Never oversimplify to the point of being wrong", "Avoid buzzwords without substance", "Don't be condescending"],
    },
    bio: {
      what_you_do: "Software engineer building web3 consumer products",
      audience: "Other developers and technical folks in the web3 space",
      perspective: "Good products come from understanding both the tech and the user",
      differentiator: "15+ years of full-stack experience applied to web3",
    },
    formatting: {
      line_breaks: "minimal",
      emojis: "none",
    },
    contentTypes: ["insight", "hot_take", "story"],
  },
  {
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
    // User-defined rules (separate from voice profile hard_rules)
    userRules: [
      { rule_type: "always", content: "End every post with 'Let's go!' or 'You got this!'" },
      { rule_type: "always", content: "Include the hashtag #FitLife" },
      { rule_type: "never", content: "Never use the word 'grind' or 'hustle'" },
      { rule_type: "never", content: "Never mention specific calorie counts" },
      { rule_type: "prefer", content: "Use 'strength' over 'skinny'" },
      { rule_type: "tone", content: "Be encouraging, not drill-sergeant aggressive" },
    ],
  },
];

// ============ RUN TESTS ============

async function runTests() {
  console.log("=".repeat(80));
  console.log("GENERATE POSTS TEST - Two-Step Pipeline");
  console.log("=".repeat(80));
  console.log();

  for (const profile of profiles) {
    console.log("=".repeat(80));
    console.log(`PROFILE: ${profile.name}`);
    console.log("=".repeat(80));
    console.log();

    // Log inputs
    console.log("--- VOICE PROFILE ---");
    console.log(`Persona: ${profile.voiceProfile.persona_summary}`);
    console.log(`Voice: ${profile.voiceProfile.voice_summary}`);
    console.log(`Hard Rules: ${profile.voiceProfile.hard_rules.join(", ")}`);
    console.log();

    console.log("--- FORMATTING ---");
    console.log(`Line Breaks: ${profile.formatting.line_breaks}`);
    console.log(`Emojis: ${profile.formatting.emojis}`);
    console.log(`Content Types: ${profile.contentTypes.join(", ")}`);
    console.log();

    // Log user rules if present
    if (profile.userRules && profile.userRules.length > 0) {
      console.log("--- USER RULES ---");
      const rulesByType = {
        always: profile.userRules.filter(r => r.rule_type === "always"),
        never: profile.userRules.filter(r => r.rule_type === "never"),
        prefer: profile.userRules.filter(r => r.rule_type === "prefer"),
        tone: profile.userRules.filter(r => r.rule_type === "tone"),
      };
      if (rulesByType.always.length > 0) {
        console.log(`ALWAYS: ${rulesByType.always.map(r => r.content).join(" | ")}`);
      }
      if (rulesByType.never.length > 0) {
        console.log(`NEVER: ${rulesByType.never.map(r => r.content).join(" | ")}`);
      }
      if (rulesByType.prefer.length > 0) {
        console.log(`PREFER: ${rulesByType.prefer.map(r => r.content).join(" | ")}`);
      }
      if (rulesByType.tone.length > 0) {
        console.log(`TONE: ${rulesByType.tone.map(r => r.content).join(" | ")}`);
      }
      console.log();
    }

    console.log("--- GENERATING... ---");
    console.log();

    try {
      const startTime = Date.now();

      const result = await AI.generatePosts({
        voiceProfile: profile.voiceProfile,
        bio: profile.bio,
        contentTypes: profile.contentTypes,
        platform: "twitter",
        maxLength: 280,
        count: 3,
        formatting: profile.formatting,
        userRules: profile.userRules || [],
        promptVersion,
      });

      const duration = Date.now() - startTime;

      console.log();
      console.log("--- RESULTS ---");
      console.log(`Duration: ${duration}ms`);
      console.log(`Model: ${result.usage?.model}`);
      console.log(`Total Tokens: ${result.usage?.total_tokens}`);
      console.log();

      result.posts.forEach((post, i) => {
        console.log(`----- POST ${i + 1} [${post.content_type}] -----`);
        console.log();
        console.log(post.content);
        console.log();
        console.log(`Characters: ${post.content.length}`);
        console.log(`Line breaks: ${(post.content.match(/\n\n/g) || []).length}`);
        console.log(`Emojis: ${(post.content.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length}`);
        console.log();
      });

    } catch (error) {
      console.error(`ERROR: ${error.message}`);
      console.error(error.stack);
    }

    console.log();
  }

  console.log("=".repeat(80));
  console.log("TESTS COMPLETE");
  console.log("=".repeat(80));
}

runTests().then(() => process.exit(0)).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
