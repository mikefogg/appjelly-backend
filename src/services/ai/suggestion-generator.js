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
  }

  /**
   * Generate post suggestions from network activity
   */
  async generateSuggestions(options = {}) {
    const {
      trendingPosts = [],
      trendingTopics = [],
      writingStyle = null,
      platform = "twitter",
      suggestionCount = 3,
    } = options;

    const startTime = Date.now();

    try {
      const systemPrompt = this.buildSystemPrompt(platform, writingStyle);
      const userPrompt = this.buildSuggestionPrompt(trendingPosts, trendingTopics, suggestionCount);

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
   * Build system prompt for suggestions
   */
  buildSystemPrompt(platform, writingStyle) {
    let prompt = `You are a social media ghostwriter that creates engaging ${platform} post suggestions.

Your goal is to suggest posts that:
1. Feel authentic and natural
2. Relate to what's being discussed in the user's network
3. Are likely to get engagement (replies, likes, shares)
4. Match the user's writing style`;

    if (writingStyle) {
      prompt += `\n\nUser's writing style:
- Tone: ${writingStyle.tone || "casual"}
- Average length: ${writingStyle.avg_length || 150} characters
- Emoji usage: ${writingStyle.emoji_frequency > 0.5 ? "frequent" : "occasional"}
- Hashtag usage: ${writingStyle.hashtag_frequency > 0.3 ? "uses hashtags" : "minimal hashtags"}`;

      if (writingStyle.common_topics && writingStyle.common_topics.length > 0) {
        prompt += `\n- Common topics: ${writingStyle.common_topics.slice(0, 5).join(", ")}`;
      }
    }

    prompt += `\n\nReturn a JSON object with this structure:
{
  "suggestions": [
    {
      "type": "original_post" | "reply",
      "content": "The suggested post text",
      "reasoning": "Why this suggestion is relevant",
      "topics": ["topic1", "topic2"]
    }
  ]
}`;

    return prompt;
  }

  /**
   * Build prompt for generating suggestions
   */
  buildSuggestionPrompt(trendingPosts, trendingTopics, count) {
    let prompt = `Based on what's happening in the user's network, suggest ${count} post ideas.\n\n`;

    if (trendingTopics.length > 0) {
      prompt += `Trending topics in their network:\n`;
      trendingTopics.forEach(topic => {
        prompt += `- ${topic.topic} (${topic.count} mentions)\n`;
      });
      prompt += "\n";
    }

    if (trendingPosts.length > 0) {
      prompt += `High-engagement posts from their network:\n`;
      trendingPosts.slice(0, 5).forEach((post, idx) => {
        prompt += `${idx + 1}. "${post.content.substring(0, 100)}${post.content.length > 100 ? "..." : ""}" (${post.engagement_score} engagement)\n`;
      });
      prompt += "\n";
    }

    prompt += `Create ${count} diverse post suggestions that:
1. Add unique perspective to these topics
2. Are likely to start conversations
3. Feel authentic to the user's style
4. Mix different types (hot takes, questions, insights, stories)`;

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
