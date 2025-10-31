/**
 * AI Suggestion Generator Service
 * Generates daily post suggestions based on network activity
 */

import OpenAI from "openai";
import promptBuilder from "#src/services/ai/prompt-builder.js";

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
      trendingTopics = [],
      voice = null,
      samplePosts = [],
      rules = [],
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

      const systemPrompt = promptBuilder.buildInterestBasedSystemPrompt(platform, voice, samplePosts, rules);
      const userPrompt = this.buildInterestBasedPrompt(topics, trendingTopics, suggestionCount, suggestionsConfig);

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
      topics = null, // User's topics_of_interest text field
      writingStyle = null,
      voice = null,
      samplePosts = [],
      rules = [],
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

      const systemPrompt = promptBuilder.buildSuggestionSystemPrompt(platform, voice, samplePosts, rules, writingStyle);
      const userPrompt = this.buildSuggestionPrompt(trendingPosts, trendingTopics, topics, suggestionCount, suggestionsConfig);

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
   * Build prompt for interest-based suggestions
   */
  buildInterestBasedPrompt(topics, trendingTopics, count, suggestionsConfig) {
    let prompt = `Generate ${count} post suggestions based on these topics the user likes to write about:

${topics}`;

    // Add trending topics if available
    if (trendingTopics && trendingTopics.length > 0) {
      prompt += `\n\nHere are some trending topics related to these areas (use for inspiration):
${trendingTopics.map((t, i) => `${i + 1}. ${t.topic} (${t.mention_count} mentions${t.context ? `, context: ${t.context}` : ''})`).join('\n')}`;
    }

    prompt += `\n\nEach suggestion should follow these specific angles and lengths:
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
   * Build prompt for generating suggestions
   */
  buildSuggestionPrompt(trendingPosts, trendingTopics, topics, count, suggestionsConfig) {
    let prompt = `Generate ${count} post suggestions that match the user's voice and interests.\n\n`;

    // User's topics of interest (text field) - PRIMARY content source
    if (topics && topics.trim().length > 0) {
      prompt += `🎯 USER'S TOPICS OF INTEREST - These are the main topics the user wants to write about:\n${topics}\n\n`;
    }

    // Trending topics are OPTIONAL additional context, not requirements
    if (trendingTopics.length > 0) {
      prompt += `📊 OPTIONAL INSPIRATION - Trending topics in their network (you can use these for additional ideas):\n`;
      trendingTopics.forEach(topic => {
        prompt += `- ${topic.topic} (${topic.mention_count} mentions, ${topic.total_engagement} total engagement)\n`;
      });
      prompt += "\n";
    }

    if (trendingPosts.length > 0) {
      prompt += `📊 OPTIONAL INSPIRATION - High-engagement posts from their network:\n`;
      prompt += `If you draw inspiration from any of these posts, include their index numbers in the "inspired_by_posts" array.\n\n`;
      trendingPosts.slice(0, 10).forEach((post, idx) => {
        prompt += `[${idx}] "${post.content.substring(0, 150)}${post.content.length > 150 ? "..." : ""}" (${post.engagement_score} engagement)\n`;
      });
      prompt += "\n";
    } else {
      prompt += `⚠️ NO NETWORK POSTS AVAILABLE - You must create original suggestions based only on the user's voice, style, and interests. Do NOT include "inspired_by_posts" in your response since there are no posts to cite.\n\n`;
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
