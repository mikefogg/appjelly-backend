/**
 * AI Post Generator Service
 * Generates social media posts from prompts using OpenAI
 */

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class PostGeneratorService {
  constructor() {
    this.model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.maxTokens = 500;
  }

  /**
   * Generate a post from a prompt
   */
  async generatePost(prompt, options = {}) {
    const {
      platform = "twitter",
      writingStyle = null,
      maxLength = 280,
      connectedAccount = null,
    } = options;

    const startTime = Date.now();

    try {
      // Build system prompt
      const systemPrompt = this.buildSystemPrompt(platform, writingStyle, maxLength);

      // Build user prompt
      const userPrompt = this.buildUserPrompt(prompt, connectedAccount);

      // Call OpenAI
      const response = await openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: this.maxTokens,
      });

      const generatedContent = response.choices[0].message.content.trim();
      const usage = response.usage;

      // Calculate cost (approximate)
      const cost = this.calculateCost(usage.prompt_tokens, usage.completion_tokens);

      const generationTime = (Date.now() - startTime) / 1000;

      return {
        content: generatedContent,
        metadata: {
          total_tokens: usage.total_tokens,
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          cost_usd: cost,
          generation_time_seconds: generationTime,
          ai_model: this.model,
          ai_provider: "openai",
        },
      };
    } catch (error) {
      console.error("Post generation error:", error);
      throw new Error(`Failed to generate post: ${error.message}`);
    }
  }

  /**
   * Regenerate a post with variations
   */
  async regeneratePost(originalPrompt, previousContent, options = {}) {
    const {
      platform = "twitter",
      writingStyle = null,
      maxLength = 280,
      variation = "different",
    } = options;

    const startTime = Date.now();

    try {
      const systemPrompt = this.buildSystemPrompt(platform, writingStyle, maxLength);

      const userPrompt = `Original prompt: "${originalPrompt}"

Previous version: "${previousContent}"

Please create a ${variation} version that maintains the core message but uses different wording, structure, or angle.`;

      const response = await openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.9, // Higher temperature for more variation
        max_tokens: this.maxTokens,
      });

      const generatedContent = response.choices[0].message.content.trim();
      const usage = response.usage;
      const cost = this.calculateCost(usage.prompt_tokens, usage.completion_tokens);
      const generationTime = (Date.now() - startTime) / 1000;

      return {
        content: generatedContent,
        metadata: {
          total_tokens: usage.total_tokens,
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          cost_usd: cost,
          generation_time_seconds: generationTime,
          ai_model: this.model,
          ai_provider: "openai",
        },
      };
    } catch (error) {
      console.error("Post regeneration error:", error);
      throw new Error(`Failed to regenerate post: ${error.message}`);
    }
  }

  /**
   * Build system prompt for post generation
   */
  buildSystemPrompt(platform, writingStyle, maxLength) {
    let prompt = `You are a social media ghostwriter specializing in ${platform} posts.

Your goal is to create engaging, authentic posts that feel natural and human-written.

Key guidelines:
- Keep posts under ${maxLength} characters
- Be conversational and authentic
- Use natural language, not marketing speak
- Don't use excessive hashtags or emojis unless it fits the style
- Make it engaging but not clickbait-y
- Write in a way that encourages replies and discussion`;

    if (writingStyle) {
      prompt += `\n\nWriting style to match:
- Tone: ${writingStyle.tone || "casual and conversational"}
- Average length: ${writingStyle.avg_length || "medium"} characters
- Style: ${writingStyle.style_summary || "Natural and authentic"}`;

      if (writingStyle.emoji_frequency > 0.5) {
        prompt += "\n- Uses emojis occasionally";
      }

      if (writingStyle.hashtag_frequency > 0.3) {
        prompt += "\n- Sometimes includes relevant hashtags";
      }

      if (writingStyle.common_phrases && writingStyle.common_phrases.length > 0) {
        prompt += `\n- Common phrases: ${writingStyle.common_phrases.slice(0, 3).join(", ")}`;
      }
    }

    prompt += "\n\nReturn ONLY the post content, no explanations or meta-commentary.";

    return prompt;
  }

  /**
   * Build user prompt
   */
  buildUserPrompt(prompt, connectedAccount) {
    let userPrompt = `Create a post about: ${prompt}`;

    if (connectedAccount?.username) {
      userPrompt += `\n\nPosting as: @${connectedAccount.username}`;
    }

    return userPrompt;
  }

  /**
   * Calculate approximate cost
   * Pricing as of 2025 for GPT-4o-mini: $0.15/1M input, $0.60/1M output
   */
  calculateCost(promptTokens, completionTokens) {
    const inputCost = (promptTokens / 1000000) * 0.15;
    const outputCost = (completionTokens / 1000000) * 0.60;
    return parseFloat((inputCost + outputCost).toFixed(6));
  }
}

export default new PostGeneratorService();
