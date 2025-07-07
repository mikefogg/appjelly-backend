import OpenAI from "openai";
import fs from "fs/promises";
import { mediaService } from "#src/helpers/index.js";

// Character Descriptions:
// Ava:
// "Ava is a young girl with light blonde, wavy hair and bright blue eyes. She has a playful, joyful expression, with a gentle smile that reflects her curiosity and imagination. Her posture is relaxed and full of energy, often dressed in simple, comfortable clothing like a light green t-shirt."

// Michael (Dad):
// "Michael is a friendly man with short brown hair, a well-groomed beard, and glasses with dark frames. He has a warm, kind smile and a gentle expression, radiating support and love. His posture is relaxed and approachable, and he typically wears casual, stylish clothing like a button-up shirt."

// Style Description:
// "The illustration style is a warm, inviting storybook aesthetic with soft, diffuse lighting and gentle gradients. The characters have cartoonish proportions with rounded, expressive faces and simple features. The setting is cozy and comforting, with soft watercolor-like textures and smooth outlines. The color palette is warm and balanced, featuring soft shadows and a gentle, clean design. The overall mood should be playful, joyful, and safe, with a minimalistic yet charming environment."

// Character Actions:

// Ava in the bath, fully clothed, surrounded by bubbles and rubber duckies, smiling happily at her dad. The bathroom is bright and cheerful, showing cozy towels and a window with stars outside.

class ImageGenerationService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Model configuration - toggle between dalle2, dalle3, and gpt-image-1
    this.imageModel = "gpt-image-1"; // Options: "dall-e-2", "dall-e-3", "gpt-image-1"

    // PLACEHOLDER CHARACTER DESCRIPTIONS - Use for all stories temporarily
    this.placeholderCharacters = {
      ava: "Ava is a young girl with light blonde, wavy hair and bright blue eyes. She has a playful, joyful expression, with a gentle smile that reflects her curiosity and imagination. Her posture is relaxed and full of energy, often dressed in simple, comfortable clothing like a light green t-shirt.",
      dad: "Dad is a friendly man with short brown hair, a well-groomed beard, and glasses with dark frames. He has a warm, kind smile and a gentle expression, radiating support and love. His posture is relaxed and approachable, and he typically wears casual, stylish clothing like a button-up shirt.",
    };

    // Standardized artistic style for all story images
    this.artisticStyle = {
      details:
        "The illustration style is a warm, inviting storybook aesthetic with soft, diffuse lighting and gentle gradients. The characters have cartoonish proportions with rounded, expressive faces and simple features. The setting is cozy and comforting, with soft watercolor-like textures and smooth outlines. The color palette is warm and balanced, featuring soft shadows and a gentle, clean design. The overall mood should be playful, joyful, and safe, with a minimalistic yet charming environment.",
    };
  }

  /**
   * Truncate prompt to fit model limits
   * @param {string} prompt - The full prompt
   * @returns {string} Truncated prompt that fits model limits
   */
  truncatePrompt(prompt) {
    const modelParams = this.getModelParams();
    let maxLength = 1000; // Default for most models

    // Different models have different prompt limits
    if (modelParams.model === "dall-e-3") {
      maxLength = 4000; // DALL-E 3 has a higher limit
    } else if (modelParams.model === "gpt-image-1") {
      maxLength = 4000; // GPT Image 1 typically has a higher limit
    } else if (modelParams.model === "dall-e-2") {
      maxLength = 1000; // DALL-E 2 has a 1000 character limit
    }

    if (prompt.length <= maxLength) {
      return prompt;
    }

    // Truncate and add ellipsis
    const truncated = prompt.substring(0, maxLength - 3) + "...";
    console.log(
      `[Prompt Truncation] Truncated prompt from ${prompt.length} to ${truncated.length} characters for ${modelParams.model}`
    );
    return truncated;
  }

  /**
   * Get model-specific parameters for image generation
   * @returns {Object} Parameters for the current model
   */
  getModelParams() {
    if (this.imageModel === "dall-e-2") {
      return {
        model: "dall-e-2",
        response_format: "url",
        size: "1024x1024",
        // DALL-E 2 doesn't support quality parameter
      };
    } else if (this.imageModel === "dall-e-3") {
      return {
        model: "dall-e-3",
        quality: "standard",
        response_format: "url",
        size: "1024x1024",
      };
    } else if (this.imageModel === "gpt-image-1") {
      return {
        model: "gpt-image-1",
        quality: "medium",
        size: "1024x1024",
        // No response_format for gpt-image-1
      };
    } else {
      throw new Error(`Unsupported image model: ${this.imageModel}`);
    }
  }

  /**
   * Format the artistic style into a prompt-friendly string
   * @returns {string} Formatted style description for image prompts
   */
  getStylePrompt() {
    return `The illustration style is a warm, inviting storybook aesthetic with soft, diffuse lighting and gentle gradients. The characters have cartoonish proportions with rounded, expressive faces and simple features. The setting is cozy and comforting, with soft watercolor-like textures and smooth outlines. The color palette is warm and balanced, featuring soft shadows and a gentle, clean design. The overall mood should be playful, joyful, and safe, with a minimalistic yet charming environment.`;
  }

  /**
   * Process image response based on model type
   * @param {Object} response - OpenAI response
   * @param {string} prefix - Filename prefix
   * @returns {string} Cloudflare image key
   */
  async processImageResponse(response, prefix) {
    const modelParams = this.getModelParams();

    if (modelParams.model === "dall-e-2" || modelParams.model === "dall-e-3") {
      // URL-based response from DALL-E 2 and DALL-E 3
      const imageUrl = response.data[0].url;

      // Download the image
      const fetchResponse = await fetch(imageUrl);
      if (!fetchResponse.ok) {
        throw new Error(
          `Failed to download image: ${fetchResponse.statusText}`
        );
      }

      const buffer = await fetchResponse.arrayBuffer();
      const imageBuffer = Buffer.from(buffer);

      // Generate unique filename
      const timestamp = Date.now();
      const filename = `${prefix}-${timestamp}.png`;

      // Upload to Cloudflare Images
      const uploadResult = await mediaService.uploadToCloudflare(
        imageBuffer,
        filename
      );

      return uploadResult.imageKey;
    } else if (modelParams.model === "gpt-image-1") {
      // Base64 response from gpt-image-1
      const imageBase64 = response.data[0].b64_json;
      const imageBuffer = Buffer.from(imageBase64, "base64");

      // Generate unique filename
      const timestamp = Date.now();
      const filename = `${prefix}-${timestamp}.png`;

      // Upload to Cloudflare Images
      const uploadResult = await mediaService.uploadToCloudflare(
        imageBuffer,
        filename
      );

      return uploadResult.imageKey;
    } else {
      throw new Error(
        `Unsupported model for image processing: ${modelParams.model}`
      );
    }
  }

  /**
   * Analyze an uploaded image to create character continuity JSON
   * @param {string} imageKey - Cloudflare image key
   * @param {Object} actor - The actor this image belongs to
   * @returns {Object} Character continuity description
   */
  async analyzeCharacterImage(imageKey, actor) {
    try {
      const imageUrl = mediaService.getImageUrl(imageKey);

      const analysisPrompt = `
Analyze this image and create a detailed character description for consistent generation in future story illustrations.

Character Name: ${actor.name}
Character Type: ${actor.type}

Please return a JSON object with detailed physical characteristics that can be used to ensure this character looks consistent across all story illustrations:

{
  "physical_appearance": {
    "age_range": "estimated age (e.g., toddler, child, adult)",
    "build": "body type description",
    "height": "relative height description",
    "face": {
      "shape": "face shape",
      "eyes": "eye color, shape, and distinctive features",
      "hair": "hair color, length, style, texture",
      "skin_tone": "skin color description",
      "distinctive_features": "any notable facial features"
    }
  },
  "clothing_style": {
    "typical_colors": "preferred color palette",
    "style": "clothing style description",
    "accessories": "any regular accessories"
  },
  "personality_visual_cues": {
    "typical_expression": "common facial expression",
    "body_language": "typical posture or gestures",
    "energy_level": "calm, energetic, etc."
  },
  "art_direction_notes": "specific notes for artists to maintain consistency"
}

Focus on details that will help an AI image generator create consistent depictions of this character across multiple illustrations.
`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: analysisPrompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const continuityData = JSON.parse(response.choices[0]?.message?.content);

      console.log(
        `[Image Analysis] Created continuity data for ${actor.name}:`,
        JSON.stringify(continuityData, null, 2)
      );

      return {
        continuity: continuityData,
        analysis_tokens: response.usage.total_tokens,
        analysis_cost: this.calculateCost(response.usage, "gpt-4o"),
      };
    } catch (error) {
      console.error(
        `[Image Analysis] Error analyzing image for ${actor.name}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Generate an avatar image from character continuity data
   * @param {Object} continuityData - Character description from analysis
   * @param {Object} actor - The actor this avatar is for
   * @returns {Object} Generated avatar info with image key
   */
  async generateAvatarImage(continuityData, actor) {
    try {
      const avatarPrompt = this.buildAvatarPrompt(continuityData, actor);
      console.log(
        `[Avatar Generation] Full prompt (${avatarPrompt.length} chars):`,
        avatarPrompt
      );

      const truncatedPrompt = this.truncatePrompt(avatarPrompt);
      console.log(
        `[Avatar Generation] Final prompt (${truncatedPrompt.length} chars):`,
        truncatedPrompt
      );

      console.log(`[Avatar Generation] Generating avatar for ${actor.name}...`);

      const modelParams = this.getModelParams();
      const response = await this.openai.images.generate({
        ...modelParams,
        prompt: truncatedPrompt,
        n: 1,
      });

      // Process image response based on model type
      const imageKey = await this.processImageResponse(
        response,
        `avatar-${actor.id}`
      );

      // Calculate cost from actual usage data
      const generationCost = this.calculateImageCost(response.usage);

      console.log(
        `[Avatar Generation] Created avatar for ${
          actor.name
        }: ${imageKey}, Cost: $${generationCost.toFixed(4)}`
      );
      console.log(`[Avatar Generation] Usage data:`, response.usage);

      return {
        image_key: imageKey,
        prompt_used: truncatedPrompt, // Store the actual prompt sent to API
        original_prompt: avatarPrompt, // Store the full original prompt
        generation_cost: generationCost,
        usage: response.usage,
        model: modelParams.model,
        quality: modelParams.quality || "n/a",
        size: modelParams.size,
        style: this.artisticStyle,
      };
    } catch (error) {
      console.error(
        `[Avatar Generation] Error generating avatar for ${actor.name}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Generate a story page image with character continuity
   * @param {string} imagePrompt - The page's image prompt
   * @param {Array} characters - Characters appearing on this page with continuity data
   * @returns {Object} Generated page image info
   */
  async generatePageImage(imagePrompt, characters = []) {
    try {
      const startTime = Date.now();
      const storyPrompt = this.buildStoryPagePrompt(imagePrompt, characters);
      console.log(
        `[Page Generation] Full prompt (${storyPrompt.length} chars):`,
        storyPrompt
      );

      const truncatedPrompt = this.truncatePrompt(storyPrompt);
      console.log(
        `[Page Generation] Final prompt (${truncatedPrompt.length} chars):`,
        truncatedPrompt
      );

      console.log(`[Page Generation] Generating page image...`);

      const modelParams = this.getModelParams();
      const response = await this.openai.images.generate({
        ...modelParams,
        prompt: truncatedPrompt,
        n: 1,
      });

      // Process image response based on model type
      const imageKey = await this.processImageResponse(
        response,
        `page-${Date.now()}`
      );

      const endTime = Date.now();
      const generationTime = (endTime - startTime) / 1000;

      // Calculate cost from actual usage data
      const generationCost = this.calculateImageCost(response.usage);

      console.log(
        `[Page Generation] Created page image: ${imageKey}, Cost: $${generationCost.toFixed(
          4
        )}`
      );
      console.log(`[Page Generation] Usage data:`, response.usage);

      return {
        image_key: imageKey,
        prompt_used: truncatedPrompt, // Store the actual prompt sent to API
        original_prompt: storyPrompt, // Store the full original prompt
        generation_cost: generationCost,
        generation_time: generationTime,
        usage: response.usage,
        model: modelParams.model,
        quality: modelParams.quality || "n/a",
        size: modelParams.size,
        style: this.artisticStyle,
      };
    } catch (error) {
      console.error(`[Page Generation] Error generating page image:`, error);
      throw error;
    }
  }

  /**
   * Build avatar prompt from continuity data
   * @param {Object} continuityData - Character description
   * @param {Object} actor - Actor info
   * @returns {string} Complete avatar prompt
   */
  buildAvatarPrompt(continuityData, actor) {
    const appearance = continuityData.physical_appearance || {};
    const face = appearance.face || {};
    const clothing = continuityData.clothing_style || {};

    return `Portrait of ${actor.name}, a ${appearance.age_range || actor.type}. 
Physical: ${appearance.build || ""} build, ${face.shape || ""} face, ${
      face.eyes || ""
    } eyes, ${face.hair || ""} hair, ${face.skin_tone || ""} skin tone. ${
      face.distinctive_features || ""
    }
Clothing: ${clothing.style || ""} in ${clothing.typical_colors || ""} colors. ${
      clothing.accessories || ""
    }
Expression: ${
      continuityData.personality_visual_cues?.typical_expression ||
      "friendly, warm smile"
    }
${continuityData.art_direction_notes || ""}

Style: ${this.getStylePrompt()}

Create a warm, friendly portrait perfect for a children's book character.`;
  }

  /**
   * Build story page prompt with character continuity
   * @param {string} imagePrompt - Original page prompt
   * @param {Array} characters - Characters with continuity data
   * @returns {string} Complete page prompt
   */
  buildStoryPagePrompt(imagePrompt, characters) {
    // PLACEHOLDER: Always use Ava and Dad descriptions for now
    let characterDescriptions = "Character Consistency Guidelines:\n\n";
    characterDescriptions += `Ava: ${this.placeholderCharacters.ava} \n`;
    characterDescriptions += `Dad (Michael): ${this.placeholderCharacters.dad}`;

    console.log(
      `[PLACEHOLDER] Using fixed character descriptions for Ava and Dad`
    );

    return [
      `What is happening in this image?\n\n ${imagePrompt}. Ensure all characters are fully clothed regardless of the scene.`,
      characterDescriptions,
      `Style:\n\n ${this.getStylePrompt()}`,
      "Ensure all characters match their established appearance for story continuity",
    ].join("\n\n");
  }

  /**
   * Calculate cost for API usage (text models)
   * @param {Object} usage - Token usage object
   * @param {string} model - Model used
   * @returns {number} Cost in USD
   */
  calculateCost(usage, model) {
    const pricing = {
      "gpt-4o": {
        input: 0.0025 / 1000, // $2.50 per 1M input tokens
        output: 0.01 / 1000, // $10.00 per 1M output tokens
      },
    };

    const modelPricing = pricing[model];
    if (!modelPricing) return 0;

    const inputCost = usage.prompt_tokens * modelPricing.input;
    const outputCost = usage.completion_tokens * modelPricing.output;

    return inputCost + outputCost;
  }

  /**
   * Calculate cost for image generation API usage
   * @param {Object} usage - Image usage object from OpenAI response
   * @returns {number} Cost in USD
   */
  calculateImageCost(usage) {
    const modelParams = this.getModelParams();

    // Handle gpt-image-1 usage format with direct cost
    if (usage && usage.total_cost) {
      console.log(
        `[Image Cost] Using direct cost from usage: $${usage.total_cost}`
      );
      return usage.total_cost;
    }

    // Handle token-based pricing for gpt-image-1
    if (modelParams.model === "gpt-image-1" && usage && usage.total_tokens) {
      console.log(
        `[Image Cost] Calculating cost from tokens: ${usage.total_tokens}`
      );
      // gpt-image-1 pricing: $0.04 per 1000 image tokens
      const costPerImageToken = 0.04 / 1000;

      // Calculate separate costs for input and output tokens if available
      let totalCost = 0;

      if (usage.prompt_tokens) {
        // Text prompt tokens - use standard text pricing
        const textCostPerToken = 0.0025 / 1000; // Approximate text token cost
        totalCost += usage.prompt_tokens * textCostPerToken;
      }

      if (usage.image_tokens) {
        // Image generation tokens
        totalCost += usage.image_tokens * costPerImageToken;
      } else {
        // Fallback: assume all tokens are image tokens
        totalCost += usage.total_tokens * costPerImageToken;
      }

      console.log(
        `[Image Cost] Calculated cost: $${totalCost.toFixed(4)} (${
          usage.total_tokens
        } tokens)`
      );
      return totalCost;
    }

    // Handle DALL-E 2 fixed pricing
    if (modelParams.model === "dall-e-2") {
      const pricing = {
        "256x256": 0.016,
        "512x512": 0.018,
        "1024x1024": 0.02,
      };

      const cost = pricing[modelParams.size];
      if (cost) {
        console.log(
          `[Image Cost] DALL-E 2 fixed cost: $${cost.toFixed(4)} (${
            modelParams.size
          })`
        );
        return cost;
      }
    }

    // Handle DALL-E 3 fixed pricing
    if (modelParams.model === "dall-e-3") {
      const pricing = {
        standard: {
          "1024x1024": 0.04,
          "1024x1792": 0.08,
          "1792x1024": 0.08,
        },
        hd: {
          "1024x1024": 0.08,
          "1024x1792": 0.12,
          "1792x1024": 0.12,
        },
      };

      const qualityPricing = pricing[modelParams.quality];
      if (qualityPricing && qualityPricing[modelParams.size]) {
        const cost = qualityPricing[modelParams.size];
        console.log(
          `[Image Cost] DALL-E 3 fixed cost: $${cost.toFixed(4)} (${
            modelParams.quality
          }, ${modelParams.size})`
        );
        return cost;
      }
    }

    // Log the usage structure to understand what we're getting
    console.log("[Image Cost] Raw usage data:", JSON.stringify(usage, null, 2));

    // Fallback for unknown formats
    if (!usage) {
      console.warn("[Image Cost] No usage data provided, using default cost");
      return 0.04;
    }

    console.warn("[Image Cost] Unknown usage format, using default cost");
    return 0.04;
  }

  /**
   * Batch generate multiple page images for efficiency
   * @param {Array} pages - Array of page objects with image_prompt and characters
   * @returns {Array} Array of generation results
   */
  async batchGeneratePageImages(pages) {
    console.log(
      `[Batch Generation] Starting batch generation for ${pages.length} pages...`
    );

    const results = [];
    const batchSize = 3; // Generate 3 at a time to avoid rate limits

    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);
      console.log(
        `[Batch Generation] Processing batch ${
          Math.floor(i / batchSize) + 1
        }/${Math.ceil(pages.length / batchSize)}`
      );

      const batchPromises = batch.map((page) =>
        this.generatePageImage(page.image_prompt, page.characters).catch(
          (error) => ({ error: error.message, page_id: page.id })
        )
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Small delay between batches to respect rate limits
      if (i + batchSize < pages.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(
      `[Batch Generation] Completed batch generation. ${
        results.filter((r) => !r.error).length
      }/${pages.length} successful`
    );
    return results;
  }
}

export default new ImageGenerationService();
