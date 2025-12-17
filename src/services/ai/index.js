/**
 * Core AI Service
 * Single OpenAI client with 4 focused functions
 */

import OpenAI from "openai";
import { getPlatformSystemPrompt } from "#src/config/platform-rules.js";
import { getPrompt, getCurrentVersion } from "#src/config/prompts.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Extract usage data from OpenAI response in a consistent format
 */
const extractUsageData = (response, model, startTime) => ({
  model,
  input_tokens: response.usage?.prompt_tokens || 0,
  output_tokens: response.usage?.completion_tokens || 0,
  total_tokens: response.usage?.total_tokens || 0,
  duration_ms: Date.now() - startTime,
});

/**
 * Get model-specific parameters
 * gpt-5 models use max_completion_tokens and don't support temperature
 */
function getModelParams(model, { tokens, temperature }) {
  if (model.startsWith("gpt-5")) {
    return { max_completion_tokens: tokens };
  }
  return { max_tokens: tokens, temperature };
}

/**
 * Build system message for content generation "as" a user
 * Combines persona, voice profile, hard rules, and formatting requirements
 *
 * @param {Object} options
 * @param {Object} options.voiceProfile - Voice profile with persona_summary, voice_summary, etc.
 * @param {Object} options.bio - Structured bio { what_you_do, audience, perspective, differentiator }
 * @param {Object} options.formatting - Formatting preferences { line_breaks, emojis }
 * @returns {string} System message for AI
 */
function buildContentSystemMessage({ voiceProfile = null, bio = null, formatting = null }) {
  const sections = [];

  // 1. PERSONA - Who you are
  const personaSummary = voiceProfile?.persona_summary;
  const hasBio = bio && Object.values(bio).some(v => v && v.trim());

  if (personaSummary) {
    sections.push(`WHO YOU ARE:\n${personaSummary}`);
  } else if (hasBio) {
    const bioLines = [
      `You are someone who ${bio.what_you_do || "creates content"}.`,
      bio.audience ? `Your audience: ${bio.audience}` : null,
      bio.perspective ? `Your perspective: ${bio.perspective}` : null,
      bio.differentiator ? `What makes you different: ${bio.differentiator}` : null,
    ].filter(Boolean);
    sections.push(`WHO YOU ARE:\n${bioLines.join("\n")}`);
  } else {
    sections.push("WHO YOU ARE:\nA thoughtful professional sharing insights with your audience.");
  }

  // 2. VOICE - How you write
  if (voiceProfile) {
    const voiceLines = [
      voiceProfile.voice_summary || "Conversational and authentic.",
      voiceProfile.sentence_patterns ? `Sentence style: ${voiceProfile.sentence_patterns}` : null,
      voiceProfile.vocabulary_notes ? `Vocabulary: ${voiceProfile.vocabulary_notes}` : null,
      voiceProfile.tone_markers ? `Tone: ${voiceProfile.tone_markers}` : null,
      voiceProfile.formatting_habits ? `Style quirks: ${voiceProfile.formatting_habits}` : null,
    ].filter(Boolean);
    sections.push(`HOW YOU WRITE:\n${voiceLines.join("\n")}`);
  }

  // Note: We intentionally don't include sample posts or voice profile examples
  // in generation prompts as the AI tends to copy their content/topics rather
  // than just matching the style. The voice profile fields (voice_summary,
  // sentence_patterns, vocabulary_notes, tone_markers) provide sufficient
  // style guidance without the templating risk.

  // 4. HARD RULES - Things to never do (filter out rules that conflict with user's explicit preferences)
  let hardRules = voiceProfile?.hard_rules || [];
  // Ensure hardRules is an array (might be string from AI)
  if (typeof hardRules === "string") {
    hardRules = [];
  }
  if (formatting && Array.isArray(hardRules)) {
    // If user explicitly wants emojis, remove any "no emoji" rules
    if (formatting.emojis && formatting.emojis !== "none") {
      hardRules = hardRules.filter(r => !r.toLowerCase().includes("emoji"));
    }
    // If user explicitly wants hashtags, remove any "no hashtag" rules (future-proofing)
    if (formatting.hashtags && formatting.hashtags !== "none") {
      hardRules = hardRules.filter(r => !r.toLowerCase().includes("hashtag"));
    }
  }
  if (Array.isArray(hardRules) && hardRules.length > 0) {
    sections.push(`NEVER:\n${hardRules.map(r => `- ${r}`).join("\n")}`);
  }

  // 5. FORMATTING REQUIREMENTS - Emojis, line breaks, etc.
  const formattingInstructions = buildFormattingInstructionsList(formatting);
  if (formattingInstructions.length > 0) {
    sections.push(`FORMATTING REQUIREMENTS:\n${formattingInstructions.map(i => `- ${i}`).join("\n")}`);
  }

  // 6. Final instruction
  sections.push("Write authentically as this person. Every post should feel like something they would actually say.");

  return sections.join("\n\n");
}

/**
 * Build line break format template to show AI the expected structure
 */
function buildLineBreakTemplate(formatting) {
  if (formatting?.line_breaks === "frequent") {
    return `LINE BREAK FORMAT - Every post MUST follow this structure with blank lines between sentences:
---
First sentence or thought.

Second sentence or thought.

Third sentence.

Final thought.
---

`;
  } else if (formatting?.line_breaks === "moderate") {
    return `LINE BREAK FORMAT - Group 2-3 related sentences, then add a blank line:
---
First thought and second thought here.

Third thought connects to fourth thought.

Final thought.
---

`;
  } else if (formatting?.line_breaks === "minimal") {
    return `LINE BREAK FORMAT - Write in flowing prose with minimal breaks:
---
First thought and second thought here. Third thought connects naturally. Final thought wraps it up.
---

`;
  }
  return "";
}

/**
 * Build formatting instructions as a list (used by buildContentSystemMessage)
 */
function buildFormattingInstructionsList(formatting) {
  if (!formatting) return [];

  const instructions = [];

  // Paragraph breaks
  if (formatting.line_breaks === "minimal") {
    instructions.push("Use minimal line breaks - write in flowing prose with sentences grouped together");
  } else if (formatting.line_breaks === "frequent") {
    instructions.push("Use VERY frequent line breaks - put a blank line after almost EVERY sentence. Each thought gets its own line. This is social media style, not essay style.");
  } else if (formatting.line_breaks === "moderate") {
    instructions.push("Use moderate line breaks - group 2-3 related sentences together, then add a blank line");
  }

  // Emojis
  if (formatting.emojis === "none") {
    instructions.push("Do NOT use any emojis");
  } else if (formatting.emojis === "sparse") {
    instructions.push("Optionally include 1-2 emojis where they feel natural");
  } else if (formatting.emojis === "moderate") {
    instructions.push("Include 3-5 emojis throughout the post for visual interest");
  } else if (formatting.emojis === "heavy") {
    instructions.push("Include 5+ emojis throughout the post for visual interest and emphasis");
  }

  // Hashtags
  instructions.push("Do NOT use any hashtags");

  return instructions;
}

/**
 * Build formatting instructions from content preferences (legacy format with header)
 */
function buildFormattingInstructions(formatting) {
  if (!formatting) return "";

  const instructions = [];

  // Paragraph breaks (double line breaks)
  if (formatting.line_breaks === "minimal") {
    instructions.push("Use minimal paragraph breaks - write in flowing prose with few or no blank lines between sentences");
  } else if (formatting.line_breaks === "frequent") {
    instructions.push("Use frequent paragraph breaks - put blank lines between thoughts/sentences for visual impact and emphasis (like social media style posts)");
  } else if (formatting.line_breaks === "moderate") {
    instructions.push("Use moderate paragraph breaks - group related sentences together with occasional blank lines between ideas");
  }

  // Emojis
  if (formatting.emojis === "none") {
    instructions.push("IMPORTANT: Do NOT use any emojis anywhere");
  } else if (formatting.emojis === "sparse") {
    instructions.push("IMPORTANT: Optionally include 1-2 emojis per post where they feel natural to add visual interest and emphasis");
  } else if (formatting.emojis === "moderate") {
    instructions.push("IMPORTANT: Use 3-5 emojis THROUGHOUT THE POST to add visual interest and emphasis");
  } else if (formatting.emojis === "heavy") {
    instructions.push("IMPORTANT: Use 5+ emojis THROUGHOUT THE POST to add visual interest and emphasis 🔥✨💡");
  }

  // Hashtags - always none for now (removed from UI)
  instructions.push("Do NOT use any hashtags");

  if (instructions.length === 0) return "";

  const result = `\n\n📋 FORMATTING REQUIREMENTS:\n${instructions.map(i => `- ${i}`).join("\n")}`;
  console.log(`[AI] Built formatting instructions from:`, JSON.stringify(formatting), `=> ${instructions.length} rules`);
  return result;
}

/**
 * Build style section from a VoiceProfile object
 */
function buildStyleSection(voiceProfile) {
  if (!voiceProfile) return "";

  let prompt = `\n\n🎯 VOICE PROFILE - Match this voice exactly:`;

  if (voiceProfile.voice_summary) {
    prompt += `\n\n**Overall Voice:** ${voiceProfile.voice_summary}`;
  }
  if (voiceProfile.sentence_patterns) {
    prompt += `\n\n**Sentence Style:** ${voiceProfile.sentence_patterns}`;
  }
  if (voiceProfile.vocabulary_notes) {
    prompt += `\n\n**Vocabulary:** ${voiceProfile.vocabulary_notes}`;
  }
  if (voiceProfile.tone_markers) {
    prompt += `\n\n**Tone:** ${voiceProfile.tone_markers}`;
  }
  if (voiceProfile.formatting_habits) {
    prompt += `\n\n**Style Quirks:** ${voiceProfile.formatting_habits}`;
  }

  const hardRules = voiceProfile.hard_rules || [];
  if (hardRules.length > 0) {
    prompt += `\n\n❌ NEVER:\n${hardRules.map((r) => `- ${r}`).join("\n")}`;
  }

  // Note: We intentionally don't include examples in generation prompts
  // as the AI tends to copy their content rather than just matching the style.

  prompt += `\n\n⚠️ CRITICAL: Match the tone, vocabulary, and sentence rhythm described above. The FORMATTING REQUIREMENTS section (if present) takes precedence for line breaks and emoji usage.`;

  prompt += `\n\nThis voice is non-negotiable. Every word must reflect this style.`;

  return prompt;
}

const AI = {
  /**
   * 1. VOICE ANALYSIS
   * Analyze sample posts, rules, and feedback to understand a user's writing voice
   * Returns both voice description AND topics in a single call
   *
   * @param {Object} options
   * @param {Array<string>} options.samplePosts - Array of sample post contents
   * @param {Array<Object>} options.rules - User's rules (never/always/prefer/tone)
   * @param {string} options.feedback - Optional user feedback/corrections
   * @returns {Object} { voice: string, topics: string, confidence: number }
   */
  async analyzeVoice({ samplePosts = [], rules = [], feedback = null }) {
    if (samplePosts.length === 0) {
      return { voice: null, topics: null, confidence: 0, usage: null };
    }

    const startTime = Date.now();
    const model = "gpt-4o-mini";

    const prompt = `Analyze these ${samplePosts.length} social media posts and extract:
1. A concise voice description (2-3 sentences describing tone, style, personality, word choice, sentence structure)
2. 3-5 main topics/themes they write about (comma-separated list)

Posts:
${samplePosts.map((content, i) => `${i + 1}. "${content}"`).join("\n")}
${rules.length > 0 ? `\nUser's content rules:\n${rules.map((r) => `- ${r.rule_type}: ${r.content}`).join("\n")}` : ""}
${feedback ? `\nUser feedback on their voice: ${feedback}` : ""}

Return JSON: { "voice": "2-3 sentence description under 200 chars", "topics": "comma-separated topics under 200 chars", "confidence": 0.0-1.0 }`;

    const response = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You analyze writing styles for AI ghostwriting. Be specific about tone, word choice, and personality. Keep descriptions concise.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 300,
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Calculate confidence based on sample count
    const baseConfidence = result.confidence || 0.5;
    const sampleBonus = Math.min(samplePosts.length * 0.1, 0.4);
    result.confidence = Math.min(baseConfidence + sampleBonus, 0.95);

    // Add usage data
    result.usage = extractUsageData(response, model, startTime);

    return result;
  },

  /**
   * 2. POST GENERATION
   * Generate a post that matches the user's voice
   *
   * @param {Object} options
   * @param {string} options.topic - What to write about
   * @param {Object} options.voiceProfile - VoiceProfile object (from VoiceProfile.toPromptFormat())
   * @param {Object} options.bio - Structured bio Q&A { what_you_do, audience, perspective, differentiator }
   * @param {string} options.contentType - story/lesson/question/proof/opinion/personal/vision/cta
   * @param {string} options.platform - twitter/linkedin/threads/ghost
   * @param {number} options.maxLength - Character limit (default 280)
   * @param {Object} options.formatting - Formatting preferences { line_breaks, emojis, hashtags }
   * @returns {Object} { content: string, metadata: Object }
   */
  async generatePost({
    topic,
    voiceProfile = null,
    bio = null,
    contentType = null,
    platform = "twitter",
    maxLength = 280,
    formatting = null,
  }) {
    const startTime = Date.now();
    const model = "gpt-4o";

    // Build system message: platform rules + persona/voice/formatting
    const platformPrompt = getPlatformSystemPrompt(platform);
    const contentSystemMessage = buildContentSystemMessage({ voiceProfile, bio, formatting });
    const systemMessage = `${platformPrompt}\n\n${contentSystemMessage}`;

    // Build formatting reminder for user prompt (reinforce what's in system message)
    const formattingReminder = buildFormattingInstructionsList(formatting);
    const formattingSection = formattingReminder.length > 0
      ? `FORMATTING REQUIREMENTS:\n${formattingReminder.map(i => `- ${i}`).join("\n")}\n\n`
      : "";

    // User message is just the task
    let userPrompt = `${formattingSection}Write a ${platform} post about: ${topic}`;
    if (contentType) {
      userPrompt += `\n\nContent type: ${contentType}`;
    }
    userPrompt += `\n\nMax ${maxLength} characters. Return ONLY the post text, no quotes or explanation.`;

    // Scale max_tokens based on target length (roughly 4 chars per token + buffer)
    const estimatedTokens = Math.ceil(maxLength / 3) + 100;
    const maxTokens = Math.min(Math.max(estimatedTokens, 500), 4000);

    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: maxTokens,
    });

    const content = response.choices[0].message.content.trim();

    return {
      content,
      metadata: {
        model,
        tokens: response.usage?.total_tokens || 0,
        platform,
        contentType,
      },
      usage: extractUsageData(response, model, startTime),
    };
  },

  /**
   * 2b. BATCH POST GENERATION (Two-Step Pipeline)
   * Step 1 (GPT-4o): Generate content ideas - creative, focused on WHAT to say
   * Step 2 (GPT-4.1): Apply voice and formatting - literal, focused on HOW to say it
   *
   * @param {Object} options
   * @param {Object} options.voiceProfile - Voice profile object from VoiceProfile.toPromptFormat()
   * @param {Object} options.bio - Structured bio Q&A { what_you_do, audience, perspective, differentiator }
   * @param {Array<string>} options.contentTypes - Array of content types (story, hot_take, insight, etc.)
   * @param {string} options.platform - twitter/linkedin/threads/ghost
   * @param {number} options.maxLength - Character limit per post (default 280)
   * @param {number} options.count - Number of posts to generate (default 3)
   * @param {Object} options.formatting - Formatting preferences { line_breaks, emojis }
   * @param {Array<Object>} options.userRules - User-defined rules [{ rule_type: 'never'|'always'|'prefer'|'tone', content: string }]
   * @param {string} options.promptVersion - Optional prompt version override (default: current)
   * @param {Array<Object>} options.ideas - Pre-defined ideas to skip Step 1 [{ idea: string, content_type: string }]
   * @returns {Array<Object>} [{ content: string, content_type: string, metadata: Object }]
   */
  async generatePosts({
    voiceProfile = null,
    bio = null,
    contentTypes = ["story", "hot_take", "insight"],
    platform = "twitter",
    maxLength = 280,
    count = 3,
    formatting = null,
    userRules = [],
    promptVersion = null,
    ideas = null,
  }) {
    const startTime = Date.now();

    // Get versioned prompts
    const version = promptVersion || getCurrentVersion("generatePosts");
    const prompts = getPrompt("generatePosts", version);

    let rawIdeas;
    let step1Usage = null;
    const step1Model = prompts.step1Model;

    // ========== STEP 1: Generate content ideas (or use provided ideas) ==========
    if (ideas && ideas.length > 0) {
      // Skip Step 1 - use provided ideas directly
      rawIdeas = ideas;
      console.log(`[AI.generatePosts] Step 1 SKIPPED - using ${ideas.length} provided idea(s)`);
      rawIdeas.forEach((idea, i) => console.log(`  ${i + 1}. [${idea.content_type}] ${idea.idea?.substring(0, 80)}...`));
    } else {
      // Run Step 1 - generate ideas from persona context
      // Build persona context for idea generation
      const personaSummary = voiceProfile?.persona_summary;
      const hasBio = bio && Object.values(bio).some(v => v && v.trim());

      let personaContext = "";
      if (personaSummary) {
        personaContext = personaSummary;
      } else if (hasBio) {
        personaContext = [
          bio.what_you_do ? `Someone who ${bio.what_you_do}` : null,
          bio.audience ? `Audience: ${bio.audience}` : null,
          bio.perspective ? `Perspective: ${bio.perspective}` : null,
        ].filter(Boolean).join(". ");
      }

      const step1System = prompts.step1System();
      const step1User = prompts.step1User({ personaContext, contentTypes, count });

      console.log(`[AI.generatePosts] Step 1 (ideas) - System:\n${step1System}`);
      console.log(`[AI.generatePosts] Step 1 (ideas) - User:\n${step1User}`);

      const step1Response = await openai.chat.completions.create({
        model: step1Model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: step1System },
          { role: "user", content: step1User },
        ],
        temperature: 0.9,
        max_tokens: 1500,
      });

      const step1Result = JSON.parse(step1Response.choices[0].message.content);
      rawIdeas = step1Result.posts || [];
      step1Usage = extractUsageData(step1Response, step1Model, startTime);

      console.log(`[AI.generatePosts] Step 1 complete: ${rawIdeas.length} ideas generated`);
      rawIdeas.forEach((idea, i) => console.log(`  ${i + 1}. [${idea.content_type}] ${idea.idea?.substring(0, 80)}...`));
    }

    // ========== STEP 2: Apply voice and formatting (GPT-4.1 - literal) ==========
    const step2Model = prompts.step2Model;
    const step2StartTime = Date.now();

    // Build voice instructions - concise and clear
    const voiceInstructions = voiceProfile ? [
      voiceProfile.voice_summary,
      voiceProfile.sentence_patterns ? `Sentence style: ${voiceProfile.sentence_patterns}` : null,
      voiceProfile.tone_markers ? `Tone: ${voiceProfile.tone_markers}` : null,
    ].filter(Boolean).join("\n") : "Write in a natural, conversational tone.";

    // Build formatting rules
    const formatRules = buildFormattingInstructionsList(formatting);
    const lineBreakTemplate = buildLineBreakTemplate(formatting);

    // Combine voice profile hard_rules with user rules
    const voiceHardRules = voiceProfile?.hard_rules || [];

    // Process user rules by type
    const userNeverRules = userRules
      .filter(r => r.rule_type === "never" && r.content)
      .map(r => r.content);
    const userAlwaysRules = userRules
      .filter(r => r.rule_type === "always" && r.content)
      .map(r => r.content);
    const userPreferRules = userRules
      .filter(r => r.rule_type === "prefer" && r.content)
      .map(r => r.content);
    const userToneRules = userRules
      .filter(r => r.rule_type === "tone" && r.content)
      .map(r => r.content);

    // Merge never rules (voice hard_rules + user never rules)
    const neverRules = [...voiceHardRules, ...userNeverRules];

    // Always rules from user (these are required in every post)
    const alwaysRules = userAlwaysRules;

    // Add prefer/tone rules to voice instructions if present
    let enhancedVoiceInstructions = voiceInstructions;
    if (userPreferRules.length > 0) {
      enhancedVoiceInstructions += `\nPreferences: ${userPreferRules.join("; ")}`;
    }
    if (userToneRules.length > 0) {
      enhancedVoiceInstructions += `\nTone adjustments: ${userToneRules.join("; ")}`;
    }

    const step2System = prompts.step2System();

    // Process all posts in parallel
    const step2Promises = rawIdeas.map(async (idea) => {
      const step2User = prompts.step2User({
        idea: idea.idea,
        voiceInstructions: enhancedVoiceInstructions,
        formatRules,
        neverRules,
        alwaysRules,
        lineBreakTemplate,
        maxLength,
      });

      const response = await openai.chat.completions.create({
        model: step2Model,
        messages: [
          { role: "system", content: step2System },
          { role: "user", content: step2User },
        ],
        temperature: 0.3, // Low temp for consistent formatting
        max_tokens: 1000,
      });

      return {
        content: response.choices[0].message.content.trim(),
        content_type: idea.content_type,
        usage: response.usage,
      };
    });

    const step2Results = await Promise.all(step2Promises);
    const step2Usage = extractUsageData(
      { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
      step2Model,
      step2StartTime
    );

    // Aggregate step 2 token usage
    let step2TotalTokens = 0;
    step2Results.forEach(r => {
      step2TotalTokens += r.usage?.total_tokens || 0;
    });

    console.log(`[AI.generatePosts] Step 2 complete: ${step2Results.length} posts formatted`);
    step2Results.forEach((post, i) => console.log(`  ${i + 1}. [${post.content_type}] ${post.content?.substring(0, 80)}...`));

    // Combine usage from both steps (step1Usage may be null if ideas were provided)
    const modelUsed = step1Usage ? `${step1Model}+${step2Model}` : step2Model;
    const step1Tokens = step1Usage?.total_tokens || 0;
    const totalUsage = {
      model: modelUsed,
      input_tokens: (step1Usage?.input_tokens || 0) + step2TotalTokens,
      output_tokens: step1Usage?.output_tokens || 0,
      total_tokens: step1Tokens + step2TotalTokens,
      duration_ms: Date.now() - startTime,
    };

    return {
      posts: step2Results.map((post) => ({
        content: post.content,
        content_type: post.content_type,
        metadata: {
          model: modelUsed,
          tokens: Math.round((step1Tokens + step2TotalTokens) / step2Results.length),
          platform,
        },
      })),
      usage: totalUsage,
    };
  },

  /**
   * 3. TOPIC EXTRACTION
   * Extract trending topics from a list of posts
   *
   * @param {Array<Object>} posts - Array of { content, engagement_score }
   * @param {Object} options
   * @param {string} options.category - Optional category context (e.g., "AI/ML", "Crypto")
   * @param {number} options.limit - Max topics to return (default 10)
   * @returns {Array<Object>} [{ topic: string, context: string, postIndices: number[] }]
   */
  async extractTopics(posts, { category = null, limit = 10 } = {}) {
    if (posts.length === 0) return [];

    const prompt = `Analyze these posts and identify up to ${limit} trending topics/themes.

${category ? `Category context: ${category}\n\n` : ""}Posts:
${posts
  .map(
    (p, i) =>
      `[${i}] "${p.content.substring(0, 200)}${p.content.length > 200 ? "..." : ""}" (${p.engagement_score || 0} engagement)`
  )
  .join("\n\n")}

For each topic:
1. Specific topic name (not generic like "technology" - be specific)
2. Brief context (1-2 sentences explaining what people are saying)
3. Which post indices discuss it

Return JSON:
{
  "topics": [
    { "topic": "specific name", "context": "what people are saying", "postIndices": [0, 3, 5] }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You analyze social media posts to identify trending topics. Be specific, not generic. Focus on what's actually being discussed.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 1500,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result.topics || [];
  },

  /**
   * 4. EVERGREEN TOPIC GENERATION
   * Generate timeless topics for a category (not tied to current events)
   *
   * @param {Object} options
   * @param {string} options.category - Category name (e.g., "AI/ML", "Startups")
   * @param {string} options.description - Category description
   * @param {number} options.count - Number of topics to generate (default 35)
   * @returns {Array<Object>} [{ topic: string, context: string }]
   */
  async generateEvergreenTopics({ category, description = "", count = 35 }) {
    const prompt = `Generate ${count} evergreen (timeless) discussion topics for the "${category}" category.

${description ? `Category description: ${description}\n\n` : ""}

Requirements:
- Topics should be timeless, not tied to current events
- Each topic should spark interesting discussions
- Be specific, not generic
- Mix different angles: trends, debates, how-tos, predictions, lessons learned
- Topics should appeal to people interested in ${category}

Return JSON:
{
  "topics": [
    { "topic": "specific topic name", "context": "1-2 sentence explanation of what makes this interesting to discuss" }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You generate engaging discussion topics for social media content creators. Topics should be evergreen (timeless) and spark interesting conversations.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result.topics || [];
  },

  /**
   * 5. VOICE PROFILE GENERATION
   * Analyze sample posts and rules to create a comprehensive voice profile
   * Used once to "learn" a user's voice, then stored for future generations
   *
   * @param {Object} options
   * @param {Array<Object>} options.samplePosts - Array of { content, notes }
   * @param {Array<Object>} options.rules - User's rules { rule_type, content }
   * @param {string} options.feedback - Optional user feedback on previous profile
   * @param {string} options.topics - User's topics of interest
   * @param {Object} options.bio - Structured bio Q&A { what_you_do, audience, perspective, differentiator }
   * @param {Object} options.formatting - Formatting preferences { line_breaks, emojis }
   * @returns {Object} Complete voice profile
   */
  async generateVoiceProfile({ samplePosts = [], rules = [], feedback = null, topics = null, bio = null, formatting = null }) {
    // No sample posts = no voice profile (can't meet 50% threshold without samples)
    if (samplePosts.length === 0) {
      return {
        voice_summary: null,
        persona_summary: null,
        sentence_patterns: null,
        vocabulary_notes: null,
        tone_markers: null,
        formatting_habits: null,
        hard_rules: [],
        examples: {},
        confidence: 0,
        confidence_reasoning: "No sample posts provided. Add sample posts to build your voice profile.",
        usage: null,
      };
    }

    const startTime = Date.now();
    const model = "gpt-4o";

    // Step 1: Analyze voice characteristics
    // Format posts to preserve line breaks and formatting
    const formattedPosts = samplePosts.map((p, i) => {
      let post = `--- POST ${i + 1} ---\n${p.content}\n--- END POST ${i + 1} ---`;
      if (p.notes) {
        post += `\n(Note: ${p.notes})`;
      }
      return post;
    }).join("\n\n");

    // Build bio context section
    const bioSection = bio && Object.values(bio).some(v => v && v.trim()) ? `
ABOUT THE WRITER:
${bio.what_you_do ? `- What they do: ${bio.what_you_do}` : ""}
${bio.audience ? `- Their audience: ${bio.audience}` : ""}
${bio.perspective ? `- Their unique perspective: ${bio.perspective}` : ""}
${bio.differentiator ? `- What makes them different: ${bio.differentiator}` : ""}
` : "";

    const analysisPrompt = `Analyze these ${samplePosts.length} social media posts to understand the writer's voice.
${bioSection}
IMPORTANT: Focus on their writing STYLE, not formatting choices like line breaks or emoji usage (those are configured separately). Pay attention to:
- Sentence structure and rhythm
- Word choice and vocabulary
- Tone and attitude
- Punctuation quirks (em-dashes, caps, ellipses)

Posts:

${formattedPosts}

${rules.length > 0 ? `\nUser's explicit rules:\n${rules.map((r) => `- ${r.rule_type.toUpperCase()}: ${r.content}`).join("\n")}` : ""}
${feedback ? `\nUser feedback on previous voice analysis: "${feedback}"` : ""}

Analyze and return JSON with these fields:

{
  "voice_summary": "2-3 sentences capturing the overall vibe, personality, and feel of this writer",
  "persona_summary": "A 1-2 sentence description of WHO this person is based on their bio - their work, audience, perspective, and what makes them unique. Write it as a prompt that starts with 'You are...' Example: 'You are a custom jewelry maker who creates simple gold pieces for teenage girls. You believe less is more, and you ship globally to make beautiful jewelry accessible to everyone.'",
  "sentence_patterns": "How they structure sentences - length, rhythm, fragments, lists, flow",
  "vocabulary_notes": "Words/phrases they love, words they avoid, formality level, jargon use",
  "tone_markers": "Attitude, humor style, confidence level, how they relate to readers",
  "formatting_habits": "Punctuation quirks (em-dashes, caps for emphasis, ellipses), list/bullet usage, paragraph structure. Do NOT mention line break frequency or emoji usage here - those are configured separately.",
  "hard_rules": ["Array of writing patterns to avoid - e.g. 'Avoid corporate jargon', 'Don't start with questions'. Do NOT include rules about emojis, hashtags, or line breaks - those are user preferences."],
  "confidence": 0.0-1.0,
  "confidence_reasoning": "Why confidence is at this level, what would improve it"
}

Be specific and actionable. Another AI will use this to write in their voice.`;

    const analysisResponse = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an expert at analyzing writing styles. Your job is to deconstruct how someone writes so another AI can replicate their voice perfectly. Be specific, not generic. Focus on what makes THIS writer unique.",
        },
        { role: "user", content: analysisPrompt },
      ],
      temperature: 0.5,
      max_tokens: 1500,
    });

    const analysisUsage = extractUsageData(analysisResponse, model, startTime);
    const profile = JSON.parse(analysisResponse.choices[0].message.content);

    // Adjust confidence based on sample count
    const sampleBonus = Math.min(samplePosts.length * 0.05, 0.3);
    const rulesBonus = rules.length > 0 ? 0.1 : 0;
    profile.confidence = Math.min(
      (profile.confidence || 0.5) + sampleBonus + rulesBonus,
      0.95
    );

    // Step 2: Generate example posts using the analyzed voice profile
    const { examples, usage: examplesUsage } = await this.generateExamples(profile, formatting);

    // Sanitize hard_rules - must be an array of strings
    let hardRules = profile.hard_rules;
    if (!Array.isArray(hardRules)) {
      hardRules = [];
    } else {
      // Filter out any non-string entries and emoji/hashtag/line break rules
      hardRules = hardRules
        .filter(r => typeof r === "string")
        .filter(r => !r.toLowerCase().includes("emoji") && !r.toLowerCase().includes("hashtag") && !r.toLowerCase().includes("line break"));
    }

    return {
      voice_summary: profile.voice_summary || "",
      persona_summary: profile.persona_summary || "",
      sentence_patterns: profile.sentence_patterns || "",
      vocabulary_notes: profile.vocabulary_notes || "",
      tone_markers: profile.tone_markers || "",
      formatting_habits: profile.formatting_habits || "",
      hard_rules: hardRules,
      examples,
      confidence: typeof profile.confidence === "number" ? profile.confidence : 0.5,
      confidence_reasoning: profile.confidence_reasoning || "",
      // Return separate usage for each AI call so they can be tracked independently
      usages: [
        { ...analysisUsage, operation: "voice_analysis" },
        { ...examplesUsage, operation: "voice_examples" },
      ],
    };
  },

  /**
   * 6. GENERATE EXAMPLES
   * Generate example posts using a voice profile
   *
   * @param {Object} profile - Voice profile fields
   * @param {Object} formatting - Formatting preferences { line_breaks, emojis }
   * @returns {Object} { hot_take, story, insight }
   */
  async generateExamples(profile, formatting = null) {
    const startTime = Date.now();
    const model = "gpt-4o";

    console.log(`[AI.generateExamples] Formatting received:`, JSON.stringify(formatting));

    // Build system message with voice profile and formatting
    const systemMessage = buildContentSystemMessage({
      voiceProfile: profile,
      formatting,
    });

    const examplePrompts = {
      hot_take: "Write a contrarian opinion about morning routines",
      story: "Write a short personal anecdote about a recent small failure or mistake",
      insight: "Write an observation about how people behave in meetings",
    };

    // Build formatting reminder for user prompt (reinforce what's in system message)
    const formattingReminder = buildFormattingInstructionsList(formatting);
    const formattingSection = formattingReminder.length > 0
      ? `FORMATTING REQUIREMENTS:\n${formattingReminder.map(i => `- ${i}`).join("\n")}\n\n`
      : "";

    // User message is just the task
    const userPrompt = `${formattingSection}Write 3 example posts (each under 280 characters):

1. ${examplePrompts.hot_take}
2. ${examplePrompts.story}
3. ${examplePrompts.insight}

Return JSON:
{
  "hot_take": { "prompt": "${examplePrompts.hot_take}", "output": "the post" },
  "story": { "prompt": "${examplePrompts.story}", "output": "the post" },
  "insight": { "prompt": "${examplePrompts.insight}", "output": "the post" }
}`;

    console.log(`[AI.generateExamples] System:\n${systemMessage}`);
    console.log(`[AI.generateExamples] User:\n${userPrompt}`);

    const response = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
      ],
      ...getModelParams(model, { tokens: 2000, temperature: 0.7 }),
    });

    const content = response.choices[0].message.content;
    console.log(`[generateExamples] Response:`, content);
    console.log(`[generateExamples] Finish reason:`, response.choices[0].finish_reason);

    return {
      examples: JSON.parse(content),
      usage: extractUsageData(response, model, startTime),
    };
  },

  /**
   * 7. APPLY VOICE FEEDBACK
   * Update a voice profile based on user feedback
   *
   * @param {Object} options
   * @param {Object} options.currentProfile - Current voice profile fields
   * @param {Array<Object>} options.samplePosts - Original sample posts (ground truth)
   * @param {string} options.feedback - User's feedback (e.g., "This is too wordy")
   * @param {string} options.referenceText - The text they're commenting on (optional)
   * @returns {Object} Updated profile fields + reasoning
   */
  async applyVoiceFeedback({ currentProfile, samplePosts = [], feedback, referenceText = null }) {
    // Format sample posts as reference (use first 2)
    const referencePosts = samplePosts.slice(0, 2);
    const samplesSection = referencePosts.length > 0
      ? `GROUND TRUTH - Here's how this person actually writes:\n\n${referencePosts.map((p, i) => `--- SAMPLE ${i + 1} ---\n${p.content}\n--- END SAMPLE ${i + 1} ---`).join("\n\n")}\n\n`
      : "";

    // Format current examples if they exist
    const examples = currentProfile.examples || {};
    const examplesSection = examples.hot_take || examples.story
      ? `CURRENT GENERATED EXAMPLES (what we produced):\n\nHot take: ${examples.hot_take?.output || "N/A"}\n\nStory: ${examples.story?.output || "N/A"}\n\nInsight: ${examples.insight?.output || "N/A"}\n\n`
      : "";

    const prompt = `${samplesSection}CURRENT VOICE PROFILE:
- Voice Summary: ${currentProfile.voice_summary || "Not set"}
- Sentence Patterns: ${currentProfile.sentence_patterns || "Not set"}
- Vocabulary Notes: ${currentProfile.vocabulary_notes || "Not set"}
- Tone Markers: ${currentProfile.tone_markers || "Not set"}
- Formatting Habits: ${currentProfile.formatting_habits || "Not set"}
- Hard Rules: ${(currentProfile.hard_rules || []).join(", ") || "None"}

${examplesSection}USER FEEDBACK: "${feedback}"
${referenceText ? `\nTEXT THEY'RE COMMENTING ON:\n"${referenceText}"` : ""}

Update the voice profile to address the feedback while staying true to the ground truth samples above. Be surgical - only change what's necessary.

Return JSON with COMPLETE updated values:
{
  "voice_summary": "<full updated text>",
  "sentence_patterns": "<full updated text>",
  "vocabulary_notes": "<full updated text>",
  "tone_markers": "<full updated text>",
  "formatting_habits": "<full updated text>",
  "hard_rules": ["<rule 1>", "<rule 2>"],
  "changes_made": "What you changed and why (1-2 sentences)",
  "confidence_delta": 0.02
}

IMPORTANT: Return FULL TEXT for each field, not placeholders. Copy unchanged fields verbatim.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You refine voice profiles based on user feedback. The sample posts are ground truth - stay true to them. Make surgical changes to fix what the user called out.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 1500,
    });

    const result = JSON.parse(response.choices[0].message.content);

    return {
      voice_summary: result.voice_summary,
      sentence_patterns: result.sentence_patterns,
      vocabulary_notes: result.vocabulary_notes,
      tone_markers: result.tone_markers,
      formatting_habits: result.formatting_habits,
      hard_rules: result.hard_rules || [],
      changes_made: result.changes_made,
      confidence_delta: result.confidence_delta || 0.02,
    };
  },
};

export default AI;
