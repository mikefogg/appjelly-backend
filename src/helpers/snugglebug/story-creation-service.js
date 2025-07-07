import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class StoryCreationService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generate a complete story from an Input with its associated actors
   * @param {Object} input - The Input model instance
   * @param {Array} actors - Array of Actor model instances
   * @returns {Object} Generated story with token usage and cost info
   */
  async generateStoryFromInput(input, actors) {
    try {
      // Step 1: Convert actors to character JSON format
      const characterJson = this.formatActorsAsCharacters(actors);
      console.log("Character JSON:", JSON.stringify(characterJson, null, 2));

      // Step 2: Generate plotline using the markdown template
      const plotlinePrompt = await this.buildPlotlinePrompt(
        input.prompt,
        characterJson
      );
      const plotlineResult = await this.generatePlotline(plotlinePrompt);
      console.log("Plotline generated:", JSON.stringify(plotlineResult.plotline, null, 2));

      // Step 3: Generate story using the plotline and markdown template
      const storyPrompt = await this.buildStoryPrompt(plotlineResult.plotline, characterJson);
      const storyResult = await this.generateStory(storyPrompt);
      console.log("\n=== GENERATED STORY ===");
      console.log(JSON.stringify(storyResult.story, null, 2));

      // Calculate total usage and costs
      const totalTokens = plotlineResult.usage.total_tokens + storyResult.usage.total_tokens;
      const estimatedCost = this.calculateCost(
        plotlineResult.usage,
        storyResult.usage
      );
      const estimatedTime = plotlineResult.time + storyResult.time;

      console.log("\n=== TOKEN USAGE ===");
      console.log(`Plotline tokens: ${plotlineResult.usage.total_tokens}`);
      console.log(`Story tokens: ${storyResult.usage.total_tokens}`);
      console.log(`Total tokens: ${totalTokens}`);
      console.log(`Estimated cost: $${estimatedCost.toFixed(4)}`);
      console.log(`Generation time: ${estimatedTime.toFixed(2)}s`);

      return {
        story: storyResult.story,
        plotline: plotlineResult.plotline,
        characterJson,
        usage: {
          plotline: plotlineResult.usage,
          story: storyResult.usage,
          total: totalTokens,
        },
        cost: estimatedCost,
        time: estimatedTime,
      };
    } catch (error) {
      console.error("Story generation error:", error);
      throw error;
    }
  }

  /**
   * Format actors into the character JSON structure
   * @param {Array} actors - Array of Actor model instances
   * @returns {Array} Character JSON array
   */
  formatActorsAsCharacters(actors) {
    return actors.map((actor) => {
      // Determine role based on type or metadata
      let role = "secondary";
      if (actor.type === "child" || actor.metadata?.isMainCharacter) {
        role = "main";
      }

      // Extract interests from metadata or use empty array
      const interests = actor.metadata?.interests || [];

      return {
        name: actor.name,
        type: actor.type || "character",
        role: role,
        interests: interests,
      };
    });
  }

  /**
   * Build the plotline prompt by merging data with markdown template
   * @param {string} storyPrompt - The user's story prompt
   * @param {Array} characterJson - The character JSON array
   * @returns {string} Complete prompt for plotline generation
   */
  async buildPlotlinePrompt(storyPrompt, characterJson) {
    const templatePath = path.join(
      __dirname,
      "../../../prompts/generate-plotline.md"
    );
    let template = await fs.readFile(templatePath, "utf-8");

    // Replace placeholders
    template = template.replace("{{STORY_PROMPT}}", storyPrompt);
    template = template.replace(
      "{{CHARACTER_JSON}}",
      JSON.stringify(characterJson, null, 2)
    );

    return template;
  }

  /**
   * Generate plotline using GPT-4 mini
   * @param {string} prompt - The complete plotline prompt
   * @returns {Object} Plotline result with usage info
   */
  async generatePlotline(prompt) {
    const startTime = Date.now();
    
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No plotline content generated");
    }

    const plotline = JSON.parse(content);
    const endTime = Date.now();

    return {
      plotline,
      usage: response.usage,
      time: (endTime - startTime) / 1000,
    };
  }

  /**
   * Build the story prompt by merging plotline with markdown template
   * @param {Object} plotline - The generated plotline object
   * @param {Array} characterJson - The character JSON array
   * @returns {string} Complete prompt for story generation
   */
  async buildStoryPrompt(plotline, characterJson) {
    const templatePath = path.join(
      __dirname,
      "../../../prompts/generate-story.md"
    );
    let template = await fs.readFile(templatePath, "utf-8");

    // Build complete input JSON with all required fields
    const storyInput = {
      plotline: plotline.plotline,
      important_actions: plotline.important_actions || [],
      magical_callouts: plotline.magical_callouts || [],
      characters: characterJson,
      sentence_complexity: "simple" // Always use simple for toddler audience
    };

    // Replace placeholder with complete story input JSON
    template = template.replace(
      "{{PLOTLINE_JSON}}",
      JSON.stringify(storyInput, null, 2)
    );

    return template;
  }

  /**
   * Generate the final story using GPT-4 mini
   * @param {string} prompt - The complete story prompt
   * @returns {Object} Story result with usage info
   */
  async generateStory(prompt) {
    const startTime = Date.now();
    
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No story content generated");
    }

    const story = JSON.parse(content);
    const endTime = Date.now();

    return {
      story,
      usage: response.usage,
      time: (endTime - startTime) / 1000,
    };
  }

  /**
   * Calculate estimated cost based on token usage
   * GPT-4o mini pricing as of 2024: $0.15 per 1M input tokens, $0.60 per 1M output tokens
   * @param {Object} plotlineUsage - Plotline generation usage
   * @param {Object} storyUsage - Story generation usage
   * @returns {number} Estimated cost in USD
   */
  calculateCost(plotlineUsage, storyUsage) {
    const inputPricePerMillion = 0.15;
    const outputPricePerMillion = 0.60;

    const totalInputTokens =
      plotlineUsage.prompt_tokens + storyUsage.prompt_tokens;
    const totalOutputTokens =
      plotlineUsage.completion_tokens + storyUsage.completion_tokens;

    const inputCost = (totalInputTokens / 1_000_000) * inputPricePerMillion;
    const outputCost = (totalOutputTokens / 1_000_000) * outputPricePerMillion;

    return inputCost + outputCost;
  }

  /**
   * Save generated story to artifact and create pages
   * @param {string} artifactId - The artifact ID
   * @param {Object} generatedStory - The complete generation result
   * @param {Object} trx - Optional database transaction
   * @returns {Object} Updated artifact with pages
   */
  async saveStoryToArtifact(artifactId, generatedStory, trx = null) {
    const { Artifact, ArtifactPage } = await import("../../models/index.js");
    
    // Update artifact with story data and token tracking
    await Artifact.query(trx)
      .findById(artifactId)
      .patch({
        // Story fields
        title: generatedStory.story.title,
        subtitle: generatedStory.story.subtitle,
        description: generatedStory.story.summary,
        
        // Token tracking fields
        total_tokens: generatedStory.usage.total,
        plotline_tokens: generatedStory.usage.plotline.total_tokens,
        story_tokens: generatedStory.usage.story.total_tokens,
        plotline_prompt_tokens: generatedStory.usage.plotline.prompt_tokens,
        plotline_completion_tokens: generatedStory.usage.plotline.completion_tokens,
        story_prompt_tokens: generatedStory.usage.story.prompt_tokens,
        story_completion_tokens: generatedStory.usage.story.completion_tokens,
        
        // Cost and performance
        cost_usd: generatedStory.cost,
        generation_time_seconds: generatedStory.time,
        
        // Model info
        ai_model: "gpt-4o-mini",
        ai_provider: "openai",
        
        // Update status to completed
        status: "completed",
        
        // Update metadata with additional info
        metadata: {
          ...((await Artifact.query(trx).findById(artifactId))?.metadata || {}),
          completed_at: new Date().toISOString(),
          plotline: generatedStory.plotline,
          character_json: generatedStory.characterJson,
        },
      });

    // Delete any existing pages (in case of regeneration)
    await ArtifactPage.query(trx)
      .where("artifact_id", artifactId)
      .delete();

    // Create new pages with minimal layout_data
    const pages = generatedStory.story.pages.map((page, index) => ({
      artifact_id: artifactId,
      page_number: index + 1,
      text: null, // Text will be in layout_data only
      image_key: null, // Will be filled later when images are generated
      image_prompt: page.image_prompt,
      image_status: "pending",
      layout_data: {
        text: page.text, // Store only the text array
      },
    }));

    await ArtifactPage.query(trx).insert(pages);

    // Return the updated artifact with pages
    return await Artifact.query(trx)
      .findById(artifactId)
      .withGraphFetched("[pages(ordered)]")
      .modifiers({
        ordered: (builder) => {
          builder.orderBy("page_number", "asc");
        },
      });
  }
}

export default new StoryCreationService();