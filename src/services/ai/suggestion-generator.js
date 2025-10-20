/**
 * AI Suggestion Generator Service
 * Generates daily post suggestions based on network activity
 */

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class SuggestionGeneratorService {
  constructor() {
    this.model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.angles = ["hot_take", "roast", "hype", "story", "teach", "question"];
    this.lengths = ["short", "medium", "long"];
  }

  /**
   * Randomly pick an angle for a suggestion
   */
  randomAngle() {
    return this.angles[Math.floor(Math.random() * this.angles.length)];
  }

  /**
   * Randomly pick a length for a suggestion
   */
  randomLength() {
    return this.lengths[Math.floor(Math.random() * this.lengths.length)];
  }

  /**
   * Generate post suggestions based on topics of interest (for ghost platform)
   */
  async generateInterestBasedSuggestions(options = {}) {
    const {
      topics = "",
      voice = null,
      samplePosts = [],
      platform = "ghost",
      suggestionCount = 3,
    } = options;

    const startTime = Date.now();

    try {
      // Generate random angle and length for each suggestion
      const suggestionsConfig = Array.from({ length: suggestionCount }, () => ({
        angle: this.randomAngle(),
        length: this.randomLength(),
      }));

      const systemPrompt = this.buildInterestBasedSystemPrompt(platform, voice, samplePosts);
      const userPrompt = this.buildInterestBasedPrompt(topics, suggestionCount, suggestionsConfig);

      const response = await openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 1500,
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content);
      const usage = response.usage;

      return {
        suggestions: result.suggestions || [],
        metadata: {
          total_tokens: usage.total_tokens,
          generation_time_seconds: (Date.now() - startTime) / 1000,
          ai_model: this.model,
        },
      };
    } catch (error) {
      console.error("Interest-based suggestion generation error:", error);
      throw new Error(`Failed to generate interest-based suggestions: ${error.message}`);
    }
  }

  /**
   * Generate post suggestions from network activity
   */
  async generateSuggestions(options = {}) {
    const {
      trendingPosts = [],
      trendingTopics = [],
      writingStyle = null,
      voice = null,
      samplePosts = [],
      platform = "twitter",
      suggestionCount = 3,
    } = options;

    const startTime = Date.now();

    try {
      // Generate random angle and length for each suggestion
      const suggestionsConfig = Array.from({ length: suggestionCount }, () => ({
        angle: this.randomAngle(),
        length: this.randomLength(),
      }));

      const systemPrompt = this.buildSystemPrompt(platform, writingStyle, voice, samplePosts);
      const userPrompt = this.buildSuggestionPrompt(trendingPosts, trendingTopics, suggestionCount, suggestionsConfig);

      const response = await openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 1500,
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content);
      const usage = response.usage;

      return {
        suggestions: result.suggestions || [],
        metadata: {
          total_tokens: usage.total_tokens,
          generation_time_seconds: (Date.now() - startTime) / 1000,
          ai_model: this.model,
        },
      };
    } catch (error) {
      console.error("Suggestion generation error:", error);
      throw new Error(`Failed to generate suggestions: ${error.message}`);
    }
  }

  /**
   * Generate a reply suggestion for a specific post
   */
  async generateReplySuggestion(sourcePost, options = {}) {
    const {
      writingStyle = null,
      platform = "twitter",
    } = options;

    const startTime = Date.now();

    try {
      const systemPrompt = this.buildReplySystemPrompt(platform, writingStyle);
      const userPrompt = this.buildReplyPrompt(sourcePost);

      const response = await openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 500,
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content);

      return {
        content: result.reply,
        reasoning: result.reasoning,
        metadata: {
          generation_time_seconds: (Date.now() - startTime) / 1000,
        },
      };
    } catch (error) {
      console.error("Reply suggestion generation error:", error);
      throw new Error(`Failed to generate reply suggestion: ${error.message}`);
    }
  }

  /**
   * Build system prompt for interest-based suggestions
   */
  buildInterestBasedSystemPrompt(platform, voice, samplePosts) {
    const platformName = platform === "ghost" ? "social media" : platform;
    let prompt = `You are a social media ghostwriter that creates engaging ${platformName} post suggestions based on the user's interests.

Your goal is to suggest posts that:
1. Feel authentic and natural to the user's voice
2. Relate to their stated topics of interest
3. Are likely to get engagement (replies, likes, shares)
4. Match their writing style`;

    // CRITICAL: Voice and samples come FIRST
    const hasVoice = voice && voice.trim().length > 0;
    const hasSamples = samplePosts && samplePosts.length > 0;

    if (hasVoice || hasSamples) {
      prompt += `\n\n🎯 CRITICAL - YOUR #1 PRIORITY:`;

      if (hasVoice) {
        prompt += `\n\nYou MUST write in this exact voice and style:
${voice}

This voice is non-negotiable. Every word must reflect this style.`;
      }

      if (hasSamples) {
        prompt += `\n\nYou MUST match the tone, style, and patterns from these example posts:`;
        samplePosts.forEach((sample, index) => {
          prompt += `\n\nExample ${index + 1}:
"${sample.content}"`;
          if (sample.notes) {
            prompt += `\n→ Key insight: ${sample.notes}`;
          }
        });
        prompt += `\n\nStudy these examples carefully. Copy the voice, rhythm, word choice, and personality.`;
      }
    }

    prompt += `\n\n⚠️ FORMATTING REQUIREMENTS:
- Use line breaks (newlines) to separate ideas and create natural paragraphs
- Line breaks add emphasis, readability, and impact - use them liberally
- Most posts should have 2-4 short paragraphs, not one dense block
- Example format:
  Opening thought or hook

  Supporting point or expansion

  Closing statement or call-to-action`;

    prompt += `\n\nReturn a JSON object with this structure:
{
  "suggestions": [
    {
      "content": "The suggested post text with natural line breaks",
      "reasoning": "Why this suggestion fits their interests",
      "topics": ["topic1", "topic2"],
      "angle": "the angle used",
      "length": "the length used"
    }
  ]
}`;

    return prompt;
  }

  /**
   * Build prompt for interest-based suggestions
   */
  buildInterestBasedPrompt(topics, count, suggestionsConfig) {
    let prompt = `Generate ${count} post suggestions based on these topics the user likes to write about:

${topics}

Each suggestion should follow these specific angles and lengths:
${suggestionsConfig.map((config, i) => `${i + 1}. Angle: "${config.angle}", Length: "${config.length}"`).join('\n')}

Angle definitions:
- hot_take: Bold, contrarian opinion that challenges conventional wisdom
- roast: Playful criticism or calling out something (not mean-spirited)
- hype: Enthusiastic, positive energy about something exciting
- story: Personal narrative or anecdote with a lesson
- teach: Educational content that explains a concept clearly
- question: Thought-provoking question that sparks discussion

Length targets:
- short: ~100-150 characters (brief and punchy)
- medium: ~200-300 characters (standard post length)
- long: ~400-500 characters (detailed, thoughtful)

Create ${count} diverse post suggestions that:
1. Match the specified angle and length for each
2. Are likely to start conversations
3. Feel authentic to the user's style
4. Show expertise and unique perspective`;

    return prompt;
  }

  /**
   * Build system prompt for suggestions
   */
  buildSystemPrompt(platform, writingStyle, voice, samplePosts) {
    let prompt = `You are a social media ghostwriter that creates engaging ${platform} post suggestions.

Your goal is to suggest posts that:
1. Feel authentic and natural to the user's voice
2. Can optionally draw inspiration from what's trending in their network
3. Are likely to get engagement (replies, likes, shares)
4. Match the user's writing style`;

    // CRITICAL: Voice and samples come FIRST - highest priority
    const hasVoice = voice && voice.trim().length > 0;
    const hasSamples = samplePosts && samplePosts.length > 0;

    if (hasVoice || hasSamples) {
      prompt += `\n\n🎯 CRITICAL - YOUR #1 PRIORITY:`;

      if (hasVoice) {
        prompt += `\n\nYou MUST write in this exact voice and style:
${voice}

This voice is non-negotiable. Every word must reflect this style.`;
      }

      if (hasSamples) {
        prompt += `\n\nYou MUST match the tone, style, and patterns from these example posts:`;
        samplePosts.forEach((sample, index) => {
          prompt += `\n\nExample ${index + 1}:
"${sample.content}"`;
          if (sample.notes) {
            prompt += `\n→ Key insight: ${sample.notes}`;
          }
        });
        prompt += `\n\nStudy these examples carefully. Copy the voice, rhythm, word choice, and personality.`;
      }
    }

    // Writing style is secondary to voice/samples
    if (writingStyle) {
      prompt += `\n\nAdditional style metadata:
- Tone: ${writingStyle.tone || "casual"}
- Average length: ${writingStyle.avg_length || 150} characters
- Emoji usage: ${writingStyle.emoji_frequency > 0.5 ? "frequent" : "occasional"}
- Hashtag usage: ${writingStyle.hashtag_frequency > 0.3 ? "uses hashtags" : "minimal hashtags"}`;

      if (writingStyle.common_topics && writingStyle.common_topics.length > 0) {
        prompt += `\n- Common topics: ${writingStyle.common_topics.slice(0, 5).join(", ")}`;
      }
    }

    prompt += `\n\n⚠️ FORMATTING REQUIREMENTS:
- Use line breaks (newlines) to separate ideas and create natural paragraphs
- Line breaks add emphasis, readability, and impact - use them liberally
- Most posts should have 2-4 short paragraphs, not one dense block
- Example format:
  Opening thought or hook

  Supporting point or expansion

  Closing statement or call-to-action`;

    prompt += `\n\nReturn a JSON object with this structure:
{
  "suggestions": [
    {
      "type": "original_post" | "reply",
      "content": "The suggested post text with natural line breaks",
      "reasoning": "Why this suggestion is relevant",
      "topics": ["topic1", "topic2"],
      "angle": "the angle used",
      "length": "the length used"
    }
  ]
}`;

    return prompt;
  }

  /**
   * Build prompt for generating suggestions
   */
  buildSuggestionPrompt(trendingPosts, trendingTopics, count, suggestionsConfig) {
    let prompt = `Generate ${count} post suggestions that match the user's voice and interests.\n\n`;

    // Trending topics are OPTIONAL context, not requirements
    if (trendingTopics.length > 0) {
      prompt += `📊 OPTIONAL INSPIRATION - Trending topics in their network (you can use these for ideas, but they're not required):\n`;
      trendingTopics.forEach(topic => {
        prompt += `- ${topic.topic} (${topic.mention_count} mentions, ${topic.total_engagement} total engagement)\n`;
      });
      prompt += "\n";
    }

    if (trendingPosts.length > 0) {
      prompt += `📊 OPTIONAL INSPIRATION - High-engagement posts from their network (you can reference these for ideas, but they're not required):\n`;
      trendingPosts.slice(0, 5).forEach((post, idx) => {
        prompt += `${idx + 1}. "${post.content.substring(0, 100)}${post.content.length > 100 ? "..." : ""}" (${post.engagement_score} engagement)\n`;
      });
      prompt += "\n";
    }

    prompt += `Each suggestion should follow these specific angles and lengths:
${suggestionsConfig.map((config, i) => `${i + 1}. Angle: "${config.angle}", Length: "${config.length}"`).join('\n')}

Angle definitions:
- hot_take: Bold, contrarian opinion that challenges conventional wisdom
- roast: Playful criticism or calling out something (not mean-spirited)
- hype: Enthusiastic, positive energy about something exciting
- story: Personal narrative or anecdote with a lesson
- teach: Educational content that explains a concept clearly
- question: Thought-provoking question that sparks discussion

Length targets:
- short: ~100-150 characters (brief and punchy)
- medium: ~200-300 characters (standard post length)
- long: ~400-500 characters (detailed, thoughtful)

Create ${count} diverse post suggestions that:
1. MUST match the user's voice and style (top priority)
2. MUST match the specified angle and length for each suggestion
3. CAN optionally draw inspiration from trending topics if relevant to the user's interests
4. Should feel authentic and natural to how the user writes
5. Are likely to start conversations and get engagement`;

    return prompt;
  }

  /**
   * Build system prompt for reply suggestions
   */
  buildReplySystemPrompt(platform, writingStyle) {
    let prompt = `You are a social media ghostwriter that suggests thoughtful replies to ${platform} posts.

Your replies should:
1. Add value to the conversation
2. Be authentic and conversational
3. Encourage further discussion
4. Match the user's writing style`;

    if (writingStyle) {
      prompt += `\n\nUser's writing style:
- Tone: ${writingStyle.tone || "casual"}
- Style: ${writingStyle.style_summary || "conversational"}`;
    }

    prompt += `\n\nReturn a JSON object:
{
  "reply": "The suggested reply text",
  "reasoning": "Why this is a good reply opportunity"
}`;

    return prompt;
  }

  /**
   * Build prompt for reply suggestion
   */
  buildReplyPrompt(sourcePost) {
    return `Suggest a thoughtful reply to this post:

"${sourcePost.content}"

Posted by: @${sourcePost.author_username || "Unknown"}
Engagement: ${sourcePost.engagement_score || 0}

Provide a reply that adds value and continues the conversation.`;
  }
}

export default new SuggestionGeneratorService();
