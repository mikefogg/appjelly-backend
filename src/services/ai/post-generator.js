/**
 * AI Post Generator Service
 * Generates social media posts from prompts using OpenAI
 */

import OpenAI from "openai";
import promptBuilder from "#src/services/ai/prompt-builder.js";

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
      angle = "hot_take",
      length = "medium",
      maxLength = 280,
      voice = null,
      samplePosts = [],
      rules = [],
      writingStyle = null,
      connectedAccount = null,
    } = options;

    const startTime = Date.now();

    try {
      // Build system prompt using shared builder
      const systemPrompt = promptBuilder.buildManualPostSystemPrompt(platform, maxLength, voice, samplePosts, rules, writingStyle);

      // Build user prompt
      const userPrompt = this.buildUserPrompt(prompt, angle, connectedAccount);

      // Log the complete prompt for debugging
      console.log("\n" + "=".repeat(80));
      console.log("📝 COMPLETE AI PROMPT");
      console.log("=".repeat(80));
      console.log("\n🤖 SYSTEM PROMPT:");
      console.log("-".repeat(80));
      console.log(systemPrompt);
      console.log("\n👤 USER PROMPT:");
      console.log("-".repeat(80));
      console.log(userPrompt);
      console.log("\n" + "=".repeat(80));
      console.log(`📊 Config: model=${this.model}, temp=0.8, max_tokens=${this.maxTokens}`);
      console.log("=".repeat(80) + "\n");

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

      // Log the response
      console.log("✅ AI RESPONSE:");
      console.log("-".repeat(80));
      console.log(generatedContent);
      console.log("\n" + "=".repeat(80));
      console.log(`📊 Usage: ${usage.total_tokens} tokens (${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion)`);
      console.log(`💰 Cost: $${cost.toFixed(6)}`);
      console.log(`⏱️  Time: ${generationTime.toFixed(2)}s`);
      console.log("=".repeat(80) + "\n");

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
      voice = null,
      samplePosts = [],
      rules = [],
      writingStyle = null,
      maxLength = 280,
      variation = "different",
    } = options;

    const startTime = Date.now();

    try {
      const systemPrompt = promptBuilder.buildManualPostSystemPrompt(platform, maxLength, voice, samplePosts, rules, writingStyle);

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
   * Build user prompt
   */
  buildUserPrompt(prompt, angle, connectedAccount) {
    // Map angle to instructions - emphasizing transformation of the topic
    const angleInstructions = {
      hot_take: "Take this topic and write a bold, controversial opinion post",
      roast: "Take this topic and write a playful, witty criticism post",
      hype: "Take this topic and write an enthusiastic, promotional post expressing excitement",
      story: "Take this topic and write a compelling narrative or personal experience post",
      teach: "Take this topic and write an educational post that explains something valuable",
      question: "Take this topic and write a thought-provoking question post to spark discussion",
    };

    const angleInstruction = angleInstructions[angle] || angleInstructions.hot_take;

    let userPrompt = `${angleInstruction}:\n\n${prompt}`;

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
