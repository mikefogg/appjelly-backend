/**
 * Core AI Service
 * Single OpenAI client with 4 focused functions
 */

import OpenAI from "openai";
import { getPlatformSystemPrompt } from "#src/config/platform-rules.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
    prompt += `\n\n**Formatting:** ${voiceProfile.formatting_habits}`;
  }

  const hardRules = voiceProfile.hard_rules || [];
  if (hardRules.length > 0) {
    prompt += `\n\n❌ NEVER:\n${hardRules.map((r) => `- ${r}`).join("\n")}`;
  }

  // Add examples - these are critical for the AI to understand the actual style
  const examples = voiceProfile.examples || {};
  if (Object.keys(examples).length > 0) {
    prompt += `\n\n📝 EXAMPLE OUTPUTS IN THIS VOICE (match this style exactly):`;
    for (const [type, example] of Object.entries(examples)) {
      if (example?.output) {
        prompt += `\n\n[${type}]:\n${example.output}`;
      }
    }
  }

  prompt += `\n\n⚠️ CRITICAL: Match the examples above. Use the same sentence length, line breaks, and formatting style. If the examples use short punchy fragments with line breaks, do the same. Do NOT write long flowing paragraphs if the examples don't.`;

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
      return { voice: null, topics: null, confidence: 0 };
    }

    const prompt = `Analyze these ${samplePosts.length} social media posts and extract:
1. A concise voice description (2-3 sentences describing tone, style, personality, word choice, sentence structure)
2. 3-5 main topics/themes they write about (comma-separated list)

Posts:
${samplePosts.map((content, i) => `${i + 1}. "${content}"`).join("\n")}
${rules.length > 0 ? `\nUser's content rules:\n${rules.map((r) => `- ${r.rule_type}: ${r.content}`).join("\n")}` : ""}
${feedback ? `\nUser feedback on their voice: ${feedback}` : ""}

Return JSON: { "voice": "2-3 sentence description under 200 chars", "topics": "comma-separated topics under 200 chars", "confidence": 0.0-1.0 }`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
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

    return result;
  },

  /**
   * 2. POST GENERATION
   * Generate a post that matches the user's voice
   *
   * @param {Object} options
   * @param {string} options.topic - What to write about
   * @param {Object} options.voiceProfile - VoiceProfile object (from VoiceProfile.toPromptFormat())
   * @param {string} options.contentType - story/lesson/question/proof/opinion/personal/vision/cta
   * @param {string} options.platform - twitter/linkedin/threads/ghost
   * @param {number} options.maxLength - Character limit (default 280)
   * @returns {Object} { content: string, metadata: Object }
   */
  async generatePost({
    topic,
    voiceProfile = null,
    contentType = null,
    platform = "twitter",
    maxLength = 280,
  }) {
    // Build system prompt: platform rules + voice style
    const platformPrompt = getPlatformSystemPrompt(platform);
    const styleSection = buildStyleSection(voiceProfile);
    const systemPrompt = platformPrompt + styleSection;

    // Build user prompt
    let userPrompt = `Write a ${platform} post about: ${topic}`;
    if (contentType) {
      userPrompt += `\n\nContent type: ${contentType}`;
    }
    userPrompt += `\n\nMax ${maxLength} characters. Return ONLY the post text, no quotes or explanation.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 500,
    });

    const content = response.choices[0].message.content.trim();

    return {
      content,
      metadata: {
        model: "gpt-4o-mini",
        tokens: response.usage?.total_tokens || 0,
        platform,
        contentType,
      },
    };
  },

  /**
   * 2b. BATCH POST GENERATION
   * Generate multiple posts in a single AI call, each with a different content type
   *
   * @param {Object} options
   * @param {string} options.topic - Topic/context to write about
   * @param {Object} options.voiceProfile - Voice profile object from VoiceProfile.toPromptFormat()
   * @param {Array<string>} options.contentTypes - Array of content types (story, hot_take, insight, etc.)
   * @param {string} options.platform - twitter/linkedin/threads/ghost
   * @param {number} options.maxLength - Character limit per post (default 280)
   * @returns {Array<Object>} [{ content: string, content_type: string, metadata: Object }]
   */
  async generatePosts({
    topic,
    voiceProfile = null,
    contentTypes = ["story", "hot_take", "insight"],
    platform = "twitter",
    maxLength = 280,
  }) {
    // Build voice context
    const voiceContext = voiceProfile ? `VOICE:
${voiceProfile.voice_summary || ""}
${voiceProfile.sentence_patterns || ""}
${voiceProfile.formatting_habits || ""}
` : "";

    // Get examples from voice profile
    const examples = voiceProfile?.examples || {};
    const exampleOutputs = Object.entries(examples)
      .map(([type, ex]) => ex?.output)
      .filter(Boolean)
      .slice(0, 3);

    const examplesSection = exampleOutputs.length > 0
      ? `EXAMPLES:\n${exampleOutputs.map((ex, i) => `---\n${ex}\n---`).join("\n\n")}\n\n`
      : "";

    const hardRules = voiceProfile?.hard_rules || [];
    const rulesSection = hardRules.length > 0
      ? `NEVER: ${hardRules.join(", ")}\n\n`
      : "";

    const userPrompt = `${voiceContext}
${examplesSection}${rulesSection}Write ${contentTypes.length} posts from someone in the world of: ${topic}

These are their interests, not a checklist. Write natural thoughts they'd share, not one post per topic.

Max ${maxLength} chars each. Match the voice and examples exactly. Don't make up accomplishments.

Return JSON: { "posts": [{ "content_type": "${contentTypes.join('", "')}", "content": "text" }] }`;

    console.log(`[AI.generatePosts] Prompt:\n${userPrompt}`);

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const result = JSON.parse(response.choices[0].message.content);
    const posts = result.posts || [];

    return posts.map((post) => ({
      content: post.content,
      content_type: post.content_type,
      metadata: {
        model: "gpt-4o-mini",
        tokens: Math.round((response.usage?.total_tokens || 0) / posts.length),
        platform,
      },
    }));
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
      model: "gpt-4o-mini",
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
   * @returns {Object} Complete voice profile
   */
  async generateVoiceProfile({ samplePosts = [], rules = [], feedback = null }) {
    if (samplePosts.length === 0) {
      return {
        voice_summary: null,
        sentence_patterns: null,
        vocabulary_notes: null,
        tone_markers: null,
        formatting_habits: null,
        hard_rules: [],
        examples: {},
        confidence: 0,
        confidence_reasoning: "No sample posts provided.",
      };
    }

    // Step 1: Analyze voice characteristics
    // Format posts to preserve line breaks and formatting
    const formattedPosts = samplePosts.map((p, i) => {
      let post = `--- POST ${i + 1} ---\n${p.content}\n--- END POST ${i + 1} ---`;
      if (p.notes) {
        post += `\n(Note: ${p.notes})`;
      }
      return post;
    }).join("\n\n");

    const analysisPrompt = `Analyze these ${samplePosts.length} social media posts to understand the writer's voice.

IMPORTANT: Pay close attention to the EXACT formatting of each post, including:
- Line breaks between sentences or segments
- Paragraph structure
- Use of whitespace for emphasis or pacing

Posts (formatting preserved exactly as written):

${formattedPosts}

${rules.length > 0 ? `\nUser's explicit rules:\n${rules.map((r) => `- ${r.rule_type.toUpperCase()}: ${r.content}`).join("\n")}` : ""}
${feedback ? `\nUser feedback on previous voice analysis: "${feedback}"` : ""}

Analyze and return JSON with these fields:

{
  "voice_summary": "2-3 sentences capturing the overall vibe, personality, and feel of this writer",
  "sentence_patterns": "How they structure sentences - length, rhythm, fragments, lists, flow",
  "vocabulary_notes": "Words/phrases they love, words they avoid, formality level, jargon use",
  "tone_markers": "Attitude, humor style, confidence level, how they relate to readers",
  "formatting_habits": "BE VERY SPECIFIC about: line breaks between segments/thoughts, paragraph breaks, punctuation quirks (em-dashes, caps, ellipses), emoji use. If they use line breaks to separate ideas, note this explicitly.",
  "hard_rules": ["Never use emojis", "Avoid corporate jargon", "Don't start with questions"],
  "confidence": 0.0-1.0,
  "confidence_reasoning": "Why confidence is at this level, what would improve it"
}

Be specific and actionable. Another AI will use this to write in their voice.`;

    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
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

    const profile = JSON.parse(analysisResponse.choices[0].message.content);

    // Adjust confidence based on sample count
    const sampleBonus = Math.min(samplePosts.length * 0.05, 0.3);
    const rulesBonus = rules.length > 0 ? 0.1 : 0;
    profile.confidence = Math.min(
      (profile.confidence || 0.5) + sampleBonus + rulesBonus,
      0.95
    );

    // Step 2: Generate example posts using the analyzed voice + original samples as reference
    const examples = await this.generateExamples(profile, samplePosts);

    return {
      voice_summary: profile.voice_summary,
      sentence_patterns: profile.sentence_patterns,
      vocabulary_notes: profile.vocabulary_notes,
      tone_markers: profile.tone_markers,
      formatting_habits: profile.formatting_habits,
      hard_rules: profile.hard_rules || [],
      examples,
      confidence: profile.confidence,
      confidence_reasoning: profile.confidence_reasoning,
    };
  },

  /**
   * 6. GENERATE EXAMPLES
   * Generate example posts using a voice profile and reference samples
   *
   * @param {Object} profile - Voice profile fields
   * @param {Array<Object>} samplePosts - Original sample posts for reference
   * @returns {Object} { hot_take, story, insight }
   */
  async generateExamples(profile, samplePosts = []) {
    const examplePrompts = {
      hot_take: "Write a contrarian opinion about morning routines",
      story: "Write a short personal anecdote about a recent small failure or mistake",
      insight: "Write an observation about how people behave in meetings",
    };

    // Format sample posts as reference (use first 2)
    const referencePosts = samplePosts.slice(0, 2);
    const referenceSection = referencePosts.length > 0
      ? `REFERENCE - Here's how this person actually writes:\n\n${referencePosts.map((p, i) => `--- SAMPLE ${i + 1} ---\n${p.content}\n--- END SAMPLE ${i + 1} ---`).join("\n\n")}\n\nMatch the voice profile below, but more importantly, match the FEEL of these reference posts. Notice the rhythm, the line breaks, the attitude, the directness.\n\n`
      : "";

    const examplesPrompt = `${referenceSection}VOICE PROFILE:
- Summary: ${profile.voice_summary}
- Sentence patterns: ${profile.sentence_patterns}
- Vocabulary: ${profile.vocabulary_notes}
- Tone: ${profile.tone_markers}
- Formatting: ${profile.formatting_habits}
- Never: ${(profile.hard_rules || []).join(", ") || "N/A"}

Write 3 posts (each under 280 characters). Return ONLY the post content, no labels:

1. ${examplePrompts.hot_take}
2. ${examplePrompts.story}
3. ${examplePrompts.insight}

Return JSON:
{
  "hot_take": { "prompt": "${examplePrompts.hot_take}", "output": "post content matching the reference style" },
  "story": { "prompt": "${examplePrompts.story}", "output": "post content matching the reference style" },
  "insight": { "prompt": "${examplePrompts.insight}", "output": "post content matching the reference style" }
}`;

    const model = "gpt-4.1-mini";
    const response = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You write social media posts that perfectly match a given voice. The reference samples are the ground truth - match their feel exactly. Be authentic, not corporate.",
        },
        { role: "user", content: examplesPrompt },
      ],
      ...getModelParams(model, { tokens: 2000, temperature: 0.7 }),
    });

    const content = response.choices[0].message.content;
    console.log(`[generateExamples] Response:`, content);
    console.log(`[generateExamples] Finish reason:`, response.choices[0].finish_reason);
    return JSON.parse(content);
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
