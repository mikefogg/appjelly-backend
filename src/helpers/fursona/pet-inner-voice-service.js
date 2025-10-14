import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PetInnerVoiceService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generate a pet's inner monologue from an Input with its associated actors
   * @param {Object} input - The Input model instance
   * @param {Array} actors - Array of Actor model instances (pets)
   * @returns {Object} Generated monologue with token usage and cost info
   */
  async generateMonologueFromInput(input, actors) {
    try {
      console.log("Input:", JSON.stringify(input, null, 2));

      // Generate monologue using the markdown template
      const monologuePrompt = `You are an emotionally unstable narrator trapped inside the subject’s head.
Write exactly one short inner monologue (1 sentence, under 15 words).

🎯 Style:
– Self-deprecating
– Slightly anxious or unhinged
– Overreacts to something mundane
– Flat, humorless tone (for TTS delivery)
– Write with natural, spoken pacing: break up phrases using ellipses (...) or dashes (—) for pauses, and use italics or ALL CAPS for subtle emphasis on specific words. Each line should sound like it’s being muttered aloud, in a choppy, faltering, or trailing-off way.
- Use <break time="1s" /> to break up for dramatic pause.

❌ Never:
– Use cleverness, poetic phrasing, or references to purpose/existence
– Exceed one sentence
– Try to be funny — the panic is the joke

Visual Description:
${input.prompt}

Examples:
– “She knows I pooped. <break time="1s" /> She knows.”
– “I should not be upright right now.”
– “They trust me WAY...<break time="1s" /> way too much.”
– “This feels... <break time="1s" /> wrong. <break time="1s" /> Like... actually wrong.”
– “Why is everyone looking... <break time="1s" /> at me... <break time="1s" /> right now?”
– “I can’t remember if I... <break time="1s" /> locked the door... <break time="1s" /> or not.”

Now generate one in that exact style. Do not try to be clever or make a joke. The sentence should feel like a breakdown in progress, not a punchline.`;

      console.log(`monologuePrompt: ${monologuePrompt}`);

      const monologueResult = await this.generateMonologue(monologuePrompt);
      console.log("Monologue generated:", monologueResult.monologue);

      // Calculate usage and costs
      const totalTokens = monologueResult.usage.total_tokens;
      const estimatedCost = this.calculateCost(monologueResult.usage);
      const estimatedTime = monologueResult.time;

      console.log("\n=== TOKEN USAGE ===");
      console.log(`Monologue tokens: ${totalTokens}`);
      console.log(`Estimated cost: $${estimatedCost.toFixed(4)}`);
      console.log(`Generation time: ${estimatedTime.toFixed(2)}s`);

      return {
        monologue: monologueResult.monologue,
        usage: {
          total: totalTokens,
          ...monologueResult.usage,
        },
        cost: estimatedCost,
        time: estimatedTime,
      };
    } catch (error) {
      console.error("Pet monologue generation error:", error);
      throw error;
    }
  }

  /**
   * Generate monologue using GPT-4o-mini
   * @param {string} prompt - The complete monologue prompt
   * @returns {Object} Monologue result with usage info
   */
  async generateMonologue(prompt) {
    const startTime = Date.now();

    const visualMessage = prompt;

    console.log(`visualMessage: ${visualMessage}`);

    const response = await this.openai.chat.completions.create({
      model: "gpt-4.1",
      temperature: 0.8,
      max_tokens: 30,
      messages: [
        {
          role: "system",
          content:
            "You are not a narrator. You are not a writer. You are not clever. You are the emotionally unstable inner monologue of the subject in the moment. You do not tell stories. You do not reflect. You do not observe. You simply panic. Your job is to speak one sentence from inside the subject’s head as they melt down over something small and real. You speak in first person. You are insecure, overwhelmed, and physically present. You do not use metaphors. You do not imagine what could happen. You just feel like everything is going wrong — even when it isn’t. You are not witty. You are not insightful. You do not imagine things that might happen. You are not trying to be funny — you are just overwhelmed and spiraling mid-action. Never use jokes, metaphors, or clever phrasing. Never make assumptions about what others think.",
        },
        {
          role: "user",
          content: visualMessage,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No monologue content generated");
    }

    const endTime = Date.now();

    return {
      monologue: content.trim(),
      usage: response.usage,
      time: (endTime - startTime) / 1000,
    };
  }

  /**
   * Calculate estimated cost based on token usage
   * GPT-4o mini pricing as of 2024: $0.15 per 1M input tokens, $0.60 per 1M output tokens
   * @param {Object} usage - Token usage from OpenAI
   * @returns {number} Estimated cost in USD
   */
  calculateCost(usage) {
    const inputPricePerMillion = 0.15;
    const outputPricePerMillion = 0.6;

    const inputCost = (usage.prompt_tokens / 1_000_000) * inputPricePerMillion;
    const outputCost =
      (usage.completion_tokens / 1_000_000) * outputPricePerMillion;

    return inputCost + outputCost;
  }

  /**
   * Save generated monologue to artifact
   * @param {string} artifactId - The artifact ID
   * @param {Object} generatedMonologue - The complete generation result
   * @param {Object} trx - Optional database transaction
   * @param {Object} options - Additional options
   * @param {boolean} options.skipAudioGeneration - Skip queueing audio generation job
   * @returns {Object} Updated artifact
   */
  async saveMonologueToArtifact(
    artifactId,
    generatedMonologue,
    trx = null,
    options = {}
  ) {
    const { Artifact } = await import("../../models/index.js");

    // Update artifact with monologue data and token tracking
    await Artifact.query(trx)
      .findById(artifactId)
      .patch({
        // Monologue fields
        title: `Inner Voice`,
        subtitle: new Date().toLocaleDateString(),
        description: generatedMonologue.monologue,

        // Token tracking fields
        total_tokens: generatedMonologue.usage.total,
        story_prompt_tokens: generatedMonologue.usage.prompt_tokens,
        story_completion_tokens: generatedMonologue.usage.completion_tokens,

        // Cost and performance
        cost_usd: generatedMonologue.cost,
        generation_time_seconds: generatedMonologue.time,

        // Model info
        ai_model: "gpt-4o-mini",
        ai_provider: "openai",

        // Update status to completed
        status: "completed",

        // Update metadata with additional info
        metadata: {
          ...((await Artifact.query(trx).findById(artifactId))?.metadata || {}),
          completed_at: new Date().toISOString(),
          monologue_text: generatedMonologue.monologue,
        },
      });

    // Return the updated artifact
    const updatedArtifact = await Artifact.query(trx).findById(artifactId);

    // Queue audio generation for the monologue (only if not skipped and not in test)
    if (
      !options.skipAudioGeneration &&
      (!trx || process.env.NODE_ENV !== "test")
    ) {
      try {
        const { mediaQueue, JOB_GENERATE_ARTIFACT_AUDIO } = await import(
          "../../background/queues/index.js"
        );

        console.log(
          `[Pet Inner Voice] Queueing audio generation for artifact ${artifactId}...`
        );

        await mediaQueue.add(
          JOB_GENERATE_ARTIFACT_AUDIO,
          {
            artifactId: artifactId,
            voice: "coral", // Using coral as base voice for Italian chef
            speed: 1.0,
          },
          {
            priority: 5,
            delay: 2000, // 2 second delay to ensure DB writes are committed
          }
        );

        console.log(
          `[Pet Inner Voice] Successfully queued audio generation job`
        );
      } catch (error) {
        console.error(
          `[Pet Inner Voice] Failed to queue audio generation job:`,
          error
        );
        // Don't throw - audio generation failure shouldn't fail monologue creation
      }
    } else if (options.skipAudioGeneration) {
      console.log(`[Pet Inner Voice] Skipping audio generation as requested`);
    }

    return updatedArtifact;
  }
}

export default new PetInnerVoiceService();
