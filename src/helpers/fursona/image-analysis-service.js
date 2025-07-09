import OpenAI from "openai";
import { Media } from "#src/models/index.js";

class ImageAnalysisService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Analyze image media object to determine what subjects are doing
   * @param {Object} mediaObject - Media model instance with image_key
   * @returns {Object} Analysis result with cost and description
   */
  async analyzeImageMedia(mediaObject) {
    try {
      // Validate that this is an image media object
      if (!mediaObject || mediaObject.media_type !== 'image') {
        throw new Error('Media object must be of type "image"');
      }

      if (!mediaObject.image_key) {
        throw new Error('Media object must have an image_key');
      }

      console.log(`[Image Analysis] Analyzing image: ${mediaObject.image_key}`);

      // Get signed URL for the image
      const imageUrl = await this.getSignedImageUrl(mediaObject.image_key);
      
      // Analyze the image using GPT-4 Vision
      const analysisResult = await this.analyzeImageWithGPT4Vision(imageUrl);

      // Update media object with analysis results
      await this.saveAnalysisResults(mediaObject.id, analysisResult);

      console.log(`[Image Analysis] Analysis completed for ${mediaObject.image_key}`);
      console.log(`[Image Analysis] Cost: $${analysisResult.cost.toFixed(6)}`);
      console.log(`[Image Analysis] Description: ${analysisResult.description.substring(0, 100)}...`);

      return analysisResult;

    } catch (error) {
      console.error('[Image Analysis] Error analyzing image:', error);
      throw error;
    }
  }

  /**
   * Get signed URL for image access (using thumbnail to reduce costs)
   * @param {string} imageKey - Cloudflare image key
   * @returns {string} Signed image URL
   */
  async getSignedImageUrl(imageKey) {
    const { default: mediaService } = await import("../media-service.js");
    // Use thumbnail variant to reduce GPT-4 Vision costs
    return mediaService.generateLocalSignedUrl(imageKey, "thumbnail", 60);
  }

  /**
   * Analyze image using GPT-4 Vision API
   * @param {string} imageUrl - URL to the image
   * @returns {Object} Analysis result with cost and description
   */
  async analyzeImageWithGPT4Vision(imageUrl) {
    try {
      const startTime = Date.now();

      const response = await this.openai.chat.completions.create({
        model: "gpt-4.1-nano", // Using 4.1-nano as it's the cheapest vision model
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this image and describe what the subjects (people, animals, objects) are doing. Focus on:
                - What activities or actions are happening
                - The setting/environment
                - The mood or atmosphere
                - Any interactions between subjects
                
                Keep the description concise but detailed enough to understand the scene.`
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        max_tokens: 200,
        temperature: 0.3, // Lower temperature for more consistent analysis
      });

      const endTime = Date.now();
      const processingTime = (endTime - startTime) / 1000;

      // Extract analysis description
      const description = response.choices[0]?.message?.content || '';
      
      // Calculate cost based on token usage
      const cost = this.calculateVisionCost(response.usage);

      return {
        description,
        cost,
        processing_time: processingTime,
        token_usage: response.usage,
        model: "gpt-4.1-nano",
        provider: "openai"
      };

    } catch (error) {
      console.error('[Image Analysis] GPT-4 Vision API failed:', error);
      throw error;
    }
  }

  /**
   * Calculate cost for GPT-4.1-nano Vision API usage
   * @param {Object} usage - Token usage from OpenAI response
   * @returns {number} Cost in USD
   */
  calculateVisionCost(usage) {
    // GPT-4.1-nano pricing (as of 2025)
    const inputPricePerMillion = 0.10;  // $0.10 per 1M input tokens
    const outputPricePerMillion = 0.40; // $0.40 per 1M output tokens
    
    const inputCost = (usage.prompt_tokens / 1_000_000) * inputPricePerMillion;
    const outputCost = (usage.completion_tokens / 1_000_000) * outputPricePerMillion;
    
    return inputCost + outputCost;
  }

  /**
   * Save analysis results to media object
   * @param {string} mediaId - Media object ID
   * @param {Object} analysisResult - Analysis result data
   */
  async saveAnalysisResults(mediaId, analysisResult) {
    try {
      await Media.query()
        .findById(mediaId)
        .patch({
          metadata: {
            // Preserve existing metadata
            ...((await Media.query().findById(mediaId))?.metadata || {}),
            // Add analysis results
            image_analysis: {
              description: analysisResult.description,
              cost_usd: analysisResult.cost,
              processing_time_seconds: analysisResult.processing_time,
              token_usage: analysisResult.token_usage,
              model: analysisResult.model,
              provider: analysisResult.provider,
              analyzed_at: new Date().toISOString(),
            }
          }
        });

      console.log(`[Image Analysis] Saved analysis results to media ${mediaId}`);
      
    } catch (error) {
      console.error('[Image Analysis] Failed to save analysis results:', error);
      throw error;
    }
  }

  /**
   * Get analysis results for a media object
   * @param {string} mediaId - Media object ID
   * @returns {Object|null} Analysis results or null if not analyzed
   */
  async getAnalysisResults(mediaId) {
    try {
      const media = await Media.query().findById(mediaId);
      return media?.metadata?.image_analysis || null;
    } catch (error) {
      console.error('[Image Analysis] Failed to get analysis results:', error);
      return null;
    }
  }

  /**
   * Check if image has been analyzed
   * @param {string} mediaId - Media object ID
   * @returns {boolean} True if analyzed, false otherwise
   */
  async hasBeenAnalyzed(mediaId) {
    const results = await this.getAnalysisResults(mediaId);
    return results !== null;
  }
}

export default new ImageAnalysisService();