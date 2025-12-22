/**
 * Versioned Prompts Configuration
 *
 * Each prompt function can have multiple versions for A/B testing and rollback.
 * Set `current` to the version you want to use in production.
 */

export const PROMPT_VERSIONS = {
  generatePosts: {
    current: "v2",
    versions: {
      // v1: Original single-step approach (deprecated)
      v1: {
        step1Model: "gpt-4o-2024-08-06",
        step2Model: "gpt-4o-2024-08-06",
        step1System: () => "You are a social media content creator who writes engaging posts.",
        step1User: ({ personaContext, contentTypes, count }) => `Generate ${count} posts for:
${personaContext}

Content types: ${contentTypes.join(", ")}

Return JSON: { "posts": [{ "content_type": "story|hot_take|insight", "content": "the post" }] }`,
        step2System: null, // v1 didn't have step 2
        step2User: null,
      },

      // v2: Two-step pipeline (GPT-4o-Nov ideas → GPT-4.1 formatting) - CURRENT DEFAULT
      v2: {
        step1Model: "gpt-4o-2024-11-20",
        step2Model: "gpt-4.1",
        step1System: () => "You generate social media post ideas. Focus on the MESSAGE and ANGLE, not formatting.",
        step1User: ({ personaContext, contentTypes, count, styleGuidelines, hardConstraints }) => {
          let prompt = `Generate ${count} post ideas for this person:
${personaContext}

Content types needed: ${contentTypes.join(", ")}

For each post, write the core message/idea that makes a clear, concrete point.
- Story posts: relatable observations or general experiences (not fabricated specific events)
- Hot takes: genuine opinions with a clear stance
- Insights: specific observations from their work/experience

CRITICAL: Each idea must be about a COMPLETELY DIFFERENT SUBJECT. Not different angles on the same subject - entirely different topics this person would discuss in their field. Think about the full range of what someone in this role talks about.

Each idea should make ONE clear point. No vague metaphors or jargon - say something real.`;

          if (styleGuidelines && styleGuidelines.length > 0) {
            prompt += `\n\nSTYLE GUIDELINES (follow these when crafting ideas):
${styleGuidelines.map(r => `- ${r}`).join("\n")}`;
          }

          if (hardConstraints && hardConstraints.length > 0) {
            prompt += `\n\nNEVER DO (avoid these in your ideas):
${hardConstraints.map(r => `- ${r}`).join("\n")}`;
          }

          prompt += `\n\nReturn JSON: { "posts": [{ "content_type": "story|hot_take|insight", "idea": "the core message" }] }`;
          return prompt;
        },
        step2System: () => "You rewrite content to match a specific voice and format. Follow ALL formatting rules EXACTLY.",
        step2User: buildStep2UserPrompt,
      },

      // Model comparison versions - same prompts, different models
      // v2-4o-aug: Both steps use GPT-4o August 2024
      "v2-4o-aug": {
        step1Model: "gpt-4o-2024-08-06",
        step2Model: "gpt-4o-2024-08-06",
        step1System: () => "You generate social media post ideas. Focus on the MESSAGE and ANGLE, not formatting.",
        step1User: ({ personaContext, contentTypes, count }) => `Generate ${count} post ideas for this person:
${personaContext}

Content types needed: ${contentTypes.join(", ")}

For each post, write the core message/idea that makes a clear, concrete point.
- Story posts: relatable observations or general experiences (not fabricated specific events)
- Hot takes: genuine opinions with a clear stance
- Insights: specific observations from their work/experience

Each idea should make ONE clear point. No vague metaphors or jargon - say something real.

Return JSON: { "posts": [{ "content_type": "story|hot_take|insight", "idea": "the core message" }] }`,
        step2System: () => "You rewrite content to match a specific voice and format. Follow ALL formatting rules EXACTLY.",
        step2User: buildStep2UserPrompt,
      },

      // v2-4o-nov: Both steps use GPT-4o November 2024
      "v2-4o-nov": {
        step1Model: "gpt-4o-2024-11-20",
        step2Model: "gpt-4o-2024-11-20",
        step1System: () => "You generate social media post ideas. Focus on the MESSAGE and ANGLE, not formatting.",
        step1User: ({ personaContext, contentTypes, count }) => `Generate ${count} post ideas for this person:
${personaContext}

Content types needed: ${contentTypes.join(", ")}

For each post, write the core message/idea that makes a clear, concrete point.
- Story posts: relatable observations or general experiences (not fabricated specific events)
- Hot takes: genuine opinions with a clear stance
- Insights: specific observations from their work/experience

Each idea should make ONE clear point. No vague metaphors or jargon - say something real.

Return JSON: { "posts": [{ "content_type": "story|hot_take|insight", "idea": "the core message" }] }`,
        step2System: () => "You rewrite content to match a specific voice and format. Follow ALL formatting rules EXACTLY.",
        step2User: buildStep2UserPrompt,
      },

      // v2-4o-aug-41: GPT-4o August for ideas, GPT-4.1 for formatting
      "v2-4o-aug-41": {
        step1Model: "gpt-4o-2024-08-06",
        step2Model: "gpt-4.1",
        step1System: () => "You generate social media post ideas. Focus on the MESSAGE and ANGLE, not formatting.",
        step1User: ({ personaContext, contentTypes, count }) => `Generate ${count} post ideas for this person:
${personaContext}

Content types needed: ${contentTypes.join(", ")}

For each post, write the core message/idea that makes a clear, concrete point.
- Story posts: relatable observations or general experiences (not fabricated specific events)
- Hot takes: genuine opinions with a clear stance
- Insights: specific observations from their work/experience

Each idea should make ONE clear point. No vague metaphors or jargon - say something real.

Return JSON: { "posts": [{ "content_type": "story|hot_take|insight", "idea": "the core message" }] }`,
        step2System: () => "You rewrite content to match a specific voice and format. Follow ALL formatting rules EXACTLY.",
        step2User: buildStep2UserPrompt,
      },

      // v2-4o-nov-41: GPT-4o November for ideas, GPT-4.1 for formatting
      "v2-4o-nov-41": {
        step1Model: "gpt-4o-2024-11-20",
        step2Model: "gpt-4.1",
        step1System: () => "You generate social media post ideas. Focus on the MESSAGE and ANGLE, not formatting.",
        step1User: ({ personaContext, contentTypes, count }) => `Generate ${count} post ideas for this person:
${personaContext}

Content types needed: ${contentTypes.join(", ")}

For each post, write the core message/idea that makes a clear, concrete point.
- Story posts: relatable observations or general experiences (not fabricated specific events)
- Hot takes: genuine opinions with a clear stance
- Insights: specific observations from their work/experience

Each idea should make ONE clear point. No vague metaphors or jargon - say something real.

Return JSON: { "posts": [{ "content_type": "story|hot_take|insight", "idea": "the core message" }] }`,
        step2System: () => "You rewrite content to match a specific voice and format. Follow ALL formatting rules EXACTLY.",
        step2User: buildStep2UserPrompt,
      },
    },
  },
};

/**
 * Shared Step 2 user prompt builder
 */
function buildStep2UserPrompt({ idea, voiceInstructions, formatRules, neverRules, alwaysRules, lineBreakTemplate, maxLength }) {
  let prompt = `Rewrite this post idea in the specified voice and format.

IDEA: ${idea}

VOICE:
${voiceInstructions}

FORMAT RULES (follow EXACTLY):
${formatRules.map(r => `- ${r}`).join("\n")}`;

  if (neverRules.length > 0) {
    prompt += `\n\nNEVER DO (strict rules):
${neverRules.map(r => `- ${r}`).join("\n")}`;
  }

  if (alwaysRules.length > 0) {
    prompt += `\n\nALWAYS DO (required in every post):
${alwaysRules.map(r => `- ${r}`).join("\n")}`;
  }

  prompt += `\n\n${lineBreakTemplate}
Target length: ~${maxLength} characters

Return ONLY the rewritten post text, nothing else.`;

  return prompt;
}

/**
 * Get a specific prompt version
 * @param {string} name - Prompt name (e.g., 'generatePosts')
 * @param {string} version - Version to get (e.g., 'v2'), or null for current
 * @returns {Object} The prompt configuration
 */
export const getPrompt = (name, version = null) => {
  const config = PROMPT_VERSIONS[name];
  if (!config) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  const v = version || config.current;
  if (!config.versions[v]) {
    throw new Error(`Unknown version ${v} for prompt ${name}`);
  }
  return config.versions[v];
};

/**
 * Get the current version string for a prompt
 * @param {string} name - Prompt name
 * @returns {string} Current version (e.g., 'v2')
 */
export const getCurrentVersion = (name) => {
  const config = PROMPT_VERSIONS[name];
  if (!config) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  return config.current;
};

/**
 * List all available versions for a prompt
 * @param {string} name - Prompt name
 * @returns {string[]} Array of version strings
 */
export const listVersions = (name) => {
  const config = PROMPT_VERSIONS[name];
  if (!config) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  return Object.keys(config.versions);
};
