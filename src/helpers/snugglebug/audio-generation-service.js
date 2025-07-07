import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

class AudioGenerationService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Audio configuration
    this.audioModel = "tts-1"; // Options: "tts-1", "tts-1-hd"
    this.defaultVoice = "nova"; // Options: "alloy", "echo", "fable", "onyx", "nova", "shimmer"
    this.audioFormat = "mp3"; // Options: "mp3", "opus", "aac", "flac", "wav", "pcm"

    // Local audio storage directory
    this.audioDir = path.join(process.cwd(), "storage", "audio");
    
    // Ensure audio directory exists
    this.ensureAudioDirectory();
  }

  /**
   * Ensure the local audio storage directory exists
   */
  async ensureAudioDirectory() {
    try {
      await fs.access(this.audioDir);
    } catch (error) {
      // Directory doesn't exist, create it
      await fs.mkdir(this.audioDir, { recursive: true });
      console.log(`[Audio Storage] Created directory: ${this.audioDir}`);
    }
  }

  /**
   * Get model-specific parameters for audio generation
   * @returns {Object} Parameters for the current model
   */
  getModelParams() {
    if (this.audioModel === "tts-1") {
      return {
        model: "tts-1",
        quality: "standard",
        speed: 1.0, // 0.25 to 4.0
      };
    } else if (this.audioModel === "tts-1-hd") {
      return {
        model: "tts-1-hd", 
        quality: "hd",
        speed: 1.0, // 0.25 to 4.0
      };
    } else {
      throw new Error(`Unsupported audio model: ${this.audioModel}`);
    }
  }

  /**
   * Calculate cost for audio generation API usage
   * @param {number} characterCount - Number of characters in the input text
   * @returns {number} Cost in USD
   */
  calculateAudioCost(characterCount) {
    const modelParams = this.getModelParams();
    
    // OpenAI TTS pricing (as of 2024)
    const pricing = {
      "tts-1": 0.015 / 1000, // $0.015 per 1K characters
      "tts-1-hd": 0.030 / 1000, // $0.030 per 1K characters
    };

    const costPerChar = pricing[modelParams.model] || pricing["tts-1"];
    const cost = characterCount * costPerChar;
    
    console.log(`[Audio Cost] ${characterCount} characters at $${costPerChar.toFixed(6)} per char = $${cost.toFixed(4)} (${modelParams.model})`);
    return cost;
  }

  /**
   * Generate audio from text using OpenAI TTS
   * @param {string} text - Text to convert to speech
   * @param {string} voice - Voice to use (optional, defaults to configured voice)
   * @param {Object} options - Additional options (speed, etc.)
   * @returns {Object} Generated audio info with file path
   */
  async generateAudio(text, voice = null, options = {}) {
    try {
      const startTime = Date.now();
      const selectedVoice = voice || this.defaultVoice;
      const modelParams = this.getModelParams();
      
      console.log(`[Audio Generation] Generating audio for ${text.length} characters...`);
      console.log(`[Audio Generation] Using voice: ${selectedVoice}, model: ${modelParams.model}`);
      console.log(`[Audio Generation] Text preview: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

      // Generate audio using OpenAI TTS
      const response = await this.openai.audio.speech.create({
        model: modelParams.model,
        voice: selectedVoice,
        input: text,
        response_format: this.audioFormat,
        speed: options.speed || modelParams.speed,
      });

      // Generate unique filename
      const timestamp = Date.now();
      const filename = `audio-${timestamp}.${this.audioFormat}`;
      const filePath = path.join(this.audioDir, filename);

      // Save audio to local file
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(filePath, buffer);

      const endTime = Date.now();
      const generationTime = (endTime - startTime) / 1000;
      const audioSize = buffer.length;

      // Calculate cost
      const generationCost = this.calculateAudioCost(text.length);

      console.log(`[Audio Generation] Created audio file: ${filename}`);
      console.log(`[Audio Generation] Size: ${audioSize} bytes, Duration: ${generationTime.toFixed(2)}s`);
      console.log(`[Audio Generation] Cost: $${generationCost.toFixed(4)}`);

      return {
        filename,
        file_path: filePath,
        text_used: text,
        character_count: text.length,
        generation_cost: generationCost,
        generation_time: generationTime,
        audio_size_bytes: audioSize,
        voice: selectedVoice,
        model: modelParams.model,
        quality: modelParams.quality,
        format: this.audioFormat,
        speed: options.speed || modelParams.speed,
      };
    } catch (error) {
      console.error(`[Audio Generation] Error generating audio:`, error);
      throw error;
    }
  }

  /**
   * Generate audio for a story page
   * @param {string} pageText - Text content of the story page
   * @param {number} pageNumber - Page number for filename
   * @param {Object} options - Generation options
   * @returns {Object} Generated page audio info
   */
  async generatePageAudio(pageText, pageNumber, options = {}) {
    try {
      const startTime = Date.now();
      
      // Clean up the text for better speech synthesis
      const cleanedText = this.cleanTextForSpeech(pageText);
      
      console.log(`[Page Audio] Generating audio for page ${pageNumber}...`);
      
      const modelParams = this.getModelParams();
      const selectedVoice = options.voice || this.defaultVoice;
      
      // Generate audio using OpenAI TTS
      const response = await this.openai.audio.speech.create({
        model: modelParams.model,
        voice: selectedVoice,
        input: cleanedText,
        response_format: this.audioFormat,
        speed: options.speed || modelParams.speed,
      });

      // Generate unique filename with page number
      const timestamp = Date.now();
      const filename = `page-${pageNumber}-${timestamp}.${this.audioFormat}`;
      const filePath = path.join(this.audioDir, filename);

      // Save audio to local file
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(filePath, buffer);

      const endTime = Date.now();
      const generationTime = (endTime - startTime) / 1000;
      const audioSize = buffer.length;

      // Calculate cost
      const generationCost = this.calculateAudioCost(cleanedText.length);

      console.log(`[Page Audio] Created audio for page ${pageNumber}: ${filename}`);
      console.log(`[Page Audio] Cost: $${generationCost.toFixed(4)}`);

      return {
        filename,
        file_path: filePath,
        page_number: pageNumber,
        text_used: cleanedText,
        original_text: pageText,
        character_count: cleanedText.length,
        generation_cost: generationCost,
        generation_time: generationTime,
        audio_size_bytes: audioSize,
        voice: selectedVoice,
        model: modelParams.model,
        quality: modelParams.quality,
        format: this.audioFormat,
        speed: options.speed || modelParams.speed,
      };
    } catch (error) {
      console.error(`[Page Audio] Error generating audio for page ${pageNumber}:`, error);
      throw error;
    }
  }

  /**
   * Clean text for better speech synthesis
   * @param {string} text - Raw text from story page
   * @returns {string} Cleaned text optimized for TTS
   */
  cleanTextForSpeech(text) {
    return text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove special characters that might cause issues
      .replace(/[^\w\s\.\,\!\?\;\:\-\'\"/]/g, '')
      // Ensure proper sentence endings
      .replace(/([^\.])\s*$/g, '$1.')
      // Add pauses for better pacing
      .replace(/\.\s+/g, '. ')
      .replace(/\,\s+/g, ', ')
      .trim();
  }

  /**
   * Batch generate audio for multiple story pages
   * @param {Array} pages - Array of page objects with text content
   * @param {Object} options - Generation options
   * @returns {Array} Array of generation results
   */
  async batchGeneratePageAudio(pages, options = {}) {
    console.log(`[Batch Audio] Starting batch generation for ${pages.length} pages...`);

    const results = [];
    const batchSize = 5; // Process 5 at a time to avoid rate limits

    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);
      console.log(`[Batch Audio] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(pages.length / batchSize)}`);

      const batchPromises = batch.map((page) =>
        this.generatePageAudio(page.text, page.page_number, options).catch((error) => ({
          error: error.message,
          page_number: page.page_number,
        }))
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Small delay between batches to respect rate limits
      if (i + batchSize < pages.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`[Batch Audio] Completed batch generation. ${results.filter((r) => !r.error).length}/${pages.length} successful`);
    return results;
  }

  /**
   * Get available voices for TTS
   * @returns {Array} List of available voices with descriptions
   */
  getAvailableVoices() {
    return [
      {
        id: "alloy",
        name: "Alloy",
        description: "Neutral, balanced voice",
        gender: "neutral",
      },
      {
        id: "echo", 
        name: "Echo",
        description: "Male voice with clear pronunciation",
        gender: "male",
      },
      {
        id: "fable",
        name: "Fable",
        description: "Female voice, warm and expressive",
        gender: "female",
      },
      {
        id: "onyx",
        name: "Onyx",
        description: "Deep male voice",
        gender: "male",
      },
      {
        id: "nova",
        name: "Nova", 
        description: "Female voice, bright and energetic",
        gender: "female",
      },
      {
        id: "shimmer",
        name: "Shimmer",
        description: "Female voice, soft and gentle",
        gender: "female",
      },
    ];
  }

  /**
   * Get audio file info
   * @param {string} filename - Audio filename
   * @returns {Object} File information
   */
  async getAudioFileInfo(filename) {
    try {
      const filePath = path.join(this.audioDir, filename);
      const stats = await fs.stat(filePath);
      
      return {
        filename,
        file_path: filePath,
        size_bytes: stats.size,
        created_at: stats.birthtime,
        modified_at: stats.mtime,
        exists: true,
      };
    } catch (error) {
      return {
        filename,
        exists: false,
        error: error.message,
      };
    }
  }

  /**
   * Delete audio file
   * @param {string} filename - Audio filename to delete
   * @returns {boolean} Success status
   */
  async deleteAudioFile(filename) {
    try {
      const filePath = path.join(this.audioDir, filename);
      await fs.unlink(filePath);
      console.log(`[Audio Storage] Deleted file: ${filename}`);
      return true;
    } catch (error) {
      console.error(`[Audio Storage] Error deleting file ${filename}:`, error);
      return false;
    }
  }
}

export default new AudioGenerationService();