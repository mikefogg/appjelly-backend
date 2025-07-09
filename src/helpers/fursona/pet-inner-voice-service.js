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
      // Get the primary pet actor (first one or marked as main)
      const petActor = actors.find(actor => actor.type === "pet") || actors[0];
      if (!petActor) {
        throw new Error("No pet actor found for monologue generation");
      }

      console.log("Pet Actor:", JSON.stringify(petActor, null, 2));

      // Generate monologue using the markdown template
      const monologuePrompt = await this.buildMonologuePrompt(
        input.prompt,
        petActor
      );
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
        petActor,
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
   * Build the monologue prompt by merging data with markdown template
   * @param {string} storyPrompt - The user's prompt about what the pet did
   * @param {Object} petActor - The pet actor object
   * @returns {string} Complete prompt for monologue generation
   */
  async buildMonologuePrompt(storyPrompt, petActor) {
    const templatePath = path.join(
      __dirname,
      "../../../prompts/generate-pet-inner-voice.md"
    );
    let template = await fs.readFile(templatePath, "utf-8");

    // Extract pet info from actor metadata
    const species = petActor.metadata?.species || petActor.metadata?.breed || "Dog";
    const age = petActor.metadata?.age || "Adult";
    const personality = petActor.metadata?.personality || 
      petActor.metadata?.traits?.join(", ") || 
      "Playful, curious, loyal";

    // Replace placeholders
    template = template.replace("{{STORY_PROMPT}}", storyPrompt);
    
    // Replace the pet info section
    template = template.replace(
      /Pet Info:[\s\S]*?Today's Event:/,
      `Pet Info:
Species: ${species}
Age: ${age}
Personality: ${personality}

Today's Event:`
    );

    return template;
  }

  /**
   * Generate monologue using GPT-4o-mini
   * @param {string} prompt - The complete monologue prompt
   * @returns {Object} Monologue result with usage info
   */
  async generateMonologue(prompt) {
    const startTime = Date.now();
    
    const response = await this.openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: 60, // Very short for 10-second videos (30-40 words max)
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
    const outputPricePerMillion = 0.60;

    const inputCost = (usage.prompt_tokens / 1_000_000) * inputPricePerMillion;
    const outputCost = (usage.completion_tokens / 1_000_000) * outputPricePerMillion;

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
  async saveMonologueToArtifact(artifactId, generatedMonologue, trx = null, options = {}) {
    const { Artifact } = await import("../../models/index.js");
    
    // Update artifact with monologue data and token tracking
    await Artifact.query(trx)
      .findById(artifactId)
      .patch({
        // Monologue fields
        title: `${generatedMonologue.petActor.name}'s Inner Voice`,
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
          pet_actor: generatedMonologue.petActor,
        },
      });

    // Return the updated artifact
    const updatedArtifact = await Artifact.query(trx)
      .findById(artifactId);

    // Queue audio generation for the monologue (only if not skipped and not in test)
    if (!options.skipAudioGeneration && (!trx || process.env.NODE_ENV !== 'test')) {
      try {
        const { mediaQueue, JOB_GENERATE_ARTIFACT_AUDIO } = await import("../../background/queues/index.js");
        
        console.log(`[Pet Inner Voice] Queueing audio generation for artifact ${artifactId}...`);
        
        await mediaQueue.add(JOB_GENERATE_ARTIFACT_AUDIO, {
          artifactId: artifactId,
          voice: 'nova', // Using nova as base voice for Italian chef
          speed: 1.0
        }, {
          priority: 5,
          delay: 2000 // 2 second delay to ensure DB writes are committed
        });
        
        console.log(`[Pet Inner Voice] Successfully queued audio generation job`);
      } catch (error) {
        console.error(`[Pet Inner Voice] Failed to queue audio generation job:`, error);
        // Don't throw - audio generation failure shouldn't fail monologue creation
      }
    } else if (options.skipAudioGeneration) {
      console.log(`[Pet Inner Voice] Skipping audio generation as requested`);
    }

    return updatedArtifact;
  }
}

export default new PetInnerVoiceService();