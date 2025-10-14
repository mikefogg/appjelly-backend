import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

class AudioGenerationService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Audio configuration
    this.audioModel = "gpt-4o-mini-tts"; // Options: "tts-1", "tts-1-hd", "gpt-4o-mini-tts"
    this.defaultVoice = "sage"; // Options: "alloy", "echo", "fable", "onyx", "nova", "shimmer", "sage"
    this.audioFormat = "wav"; // Options: "mp3", "opus", "aac", "flac", "wav", "pcm"

    // Voice presets with custom instructions for gpt-4o-mini-tts
    this.voicePresets = {
      sage: {
        voice: "sage",
        instructions: `Affect: A gentle, curious narrator with a British accent, guiding a magical, child-friendly adventure through a fairy tale world.
          Tone: Magical, warm, and inviting, creating a sense of wonder and excitement for young listeners.
          Pacing: Steady and measured, with slight pauses to emphasize magical moments and maintain the storytelling flow.
          Emotion: Wonder, curiosity, and a sense of adventure, with a lighthearted and positive vibe throughout.
          Pronunciation: Clear and precise, with an emphasis on storytelling, ensuring the words are easy to follow and enchanting to listen to.`,
        description:
          "Custom sage voice for bedtime stories with deep tranquility and magic",
      },
      default: {
        voice: "nova",
        instructions: null,
        description: "Bright and energetic default voice",
      },
    };

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
   * Resolve voice preset or use direct voice/speed values
   * @param {string} voice - Voice preset name or direct voice
   * @param {number} speed - Speed override (optional)
   * @returns {Object} Resolved voice settings
   */
  resolveVoiceSettings(voice, speed = null) {
    // Check if it's a preset
    if (this.voicePresets[voice]) {
      const preset = this.voicePresets[voice];
      return {
        voice: preset.voice,
        speed: speed !== null ? speed : preset.speed,
        preset: voice,
        description: preset.description,
      };
    }

    // Direct voice specification
    const validVoices = [
      "alloy",
      "echo",
      "fable",
      "onyx",
      "nova",
      "shimmer",
      "sage",
    ];
    if (validVoices.includes(voice)) {
      return {
        voice: voice,
        speed: speed !== null ? speed : 1.0,
        preset: null,
        description: `Direct voice: ${voice}`,
      };
    }

    // Fallback to default
    return {
      voice: this.defaultVoice,
      speed: speed !== null ? speed : 1.0,
      preset: "default",
      description: "Default voice settings",
    };
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
    } else if (this.audioModel === "gpt-4o-mini-tts") {
      return {
        model: "gpt-4o-mini-tts",
        quality: "standard",
        speed: 1.0, // 0.25 to 4.0
        supportsInstructions: true,
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
      "tts-1-hd": 0.03 / 1000, // $0.030 per 1K characters
      "gpt-4o-mini-tts": 0.015 / 1000, // $0.015 per 1K characters (same as tts-1)
    };

    const costPerChar = pricing[modelParams.model] || pricing["tts-1"];
    const cost = characterCount * costPerChar;

    console.log(
      `[Audio Cost] ${characterCount} characters at $${costPerChar.toFixed(
        6
      )} per char = $${cost.toFixed(4)} (${modelParams.model})`
    );
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
      const voiceSettings = this.resolveVoiceSettings(
        selectedVoice,
        options.speed
      );

      console.log(
        `[Audio Generation] Generating audio for ${text.length} characters...`
      );
      console.log(
        `[Audio Generation] Using voice: ${voiceSettings.voice}, model: ${modelParams.model}`
      );
      console.log(
        `[Audio Generation] Voice preset: ${voiceSettings.preset || "none"}`
      );
      console.log(
        `[Audio Generation] Text preview: "${text.substring(0, 100)}${
          text.length > 100 ? "..." : ""
        }"`
      );

      // Prepare the API call parameters
      const apiParams = {
        model: modelParams.model,
        voice: voiceSettings.voice,
        input: text,
        response_format: this.audioFormat,
        speed: voiceSettings.speed,
      };

      // Add custom instructions for gpt-4o-mini-tts if voice preset has them
      if (
        modelParams.supportsInstructions &&
        voiceSettings.preset &&
        this.voicePresets[voiceSettings.preset]?.instructions
      ) {
        apiParams.instructions =
          this.voicePresets[voiceSettings.preset].instructions;
        console.log(
          `[Audio Generation] Using custom voice instructions for ${voiceSettings.preset}`
        );
      }

      // Generate audio using OpenAI TTS
      const response = await this.openai.audio.speech.create(apiParams);

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
      console.log(
        `[Audio Generation] Size: ${audioSize} bytes, Duration: ${generationTime.toFixed(
          2
        )}s`
      );
      console.log(`[Audio Generation] Cost: $${generationCost.toFixed(4)}`);

      return {
        filename,
        file_path: filePath,
        text_used: text,
        character_count: text.length,
        generation_cost: generationCost,
        generation_time: generationTime,
        audio_size_bytes: audioSize,
        voice: voiceSettings.voice,
        voice_preset: voiceSettings.preset,
        model: modelParams.model,
        quality: modelParams.quality,
        format: this.audioFormat,
        speed: voiceSettings.speed,
        instructions_used:
          modelParams.supportsInstructions && voiceSettings.preset
            ? this.voicePresets[voiceSettings.preset]?.instructions
            : null,
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

      const modelParams = this.getModelParams();
      const selectedVoice = options.voice || this.defaultVoice;
      const voiceSettings = this.resolveVoiceSettings(
        selectedVoice,
        options.speed
      );

      // Clean up the text for better speech synthesis
      const cleanedText = this.cleanTextForSpeech(
        pageText,
        voiceSettings.preset
      );

      console.log(`[Page Audio] Generating audio for page ${pageNumber}...`);
      console.log(
        `[Page Audio] Using voice: ${voiceSettings.voice}, preset: ${
          voiceSettings.preset || "none"
        }`
      );

      // Prepare the API call parameters
      const apiParams = {
        model: modelParams.model,
        voice: voiceSettings.voice,
        input: cleanedText,
        response_format: this.audioFormat,
        speed: voiceSettings.speed,
      };

      // Add custom instructions for gpt-4o-mini-tts if voice preset has them
      if (
        modelParams.supportsInstructions &&
        voiceSettings.preset &&
        this.voicePresets[voiceSettings.preset]?.instructions
      ) {
        apiParams.instructions =
          this.voicePresets[voiceSettings.preset].instructions;
        console.log(
          `[Page Audio] Using custom voice instructions for ${voiceSettings.preset}`
        );
      }

      // Generate audio using OpenAI TTS
      const response = await this.openai.audio.speech.create(apiParams);

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

      console.log(
        `[Page Audio] Created audio for page ${pageNumber}: ${filename}`
      );
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
        voice: voiceSettings.voice,
        voice_preset: voiceSettings.preset,
        model: modelParams.model,
        quality: modelParams.quality,
        format: this.audioFormat,
        speed: voiceSettings.speed,
        instructions_used:
          modelParams.supportsInstructions && voiceSettings.preset
            ? this.voicePresets[voiceSettings.preset]?.instructions
            : null,
      };
    } catch (error) {
      console.error(
        `[Page Audio] Error generating audio for page ${pageNumber}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Clean text for better speech synthesis
   * @param {string} text - Raw text from story page
   * @param {string} voicePreset - Voice preset to optimize for
   * @returns {string} Cleaned text optimized for TTS
   */
  cleanTextForSpeech(text, voicePreset = null) {
    let cleanedText = text
      // Remove excessive whitespace
      .replace(/\s+/g, " ")
      // Remove special characters that might cause issues
      .replace(/[^\w\s\.\,\!\?\;\:\-\'\"/]/g, "")
      // Ensure proper sentence endings
      .replace(/([^\.])\s*$/g, "$1.")
      .trim();

    return cleanedText;
  }

  /**
   * Enhance text specifically for the sage voice preset
   * @param {string} text - Cleaned text
   * @returns {string} Text with sage voice enhancements
   */
  enhanceTextForSageVoice(text) {
    return (
      text
        // Add longer pauses after sentences for reflection
        .replace(/\.\s+/g, "... ")
        // Add pauses after commas for deliberate pacing
        .replace(/\,\s+/g, ", ... ")
        // Add pauses before and after dialogue or quoted text
        .replace(/"/g, ' ... " ... ')
        // Add gentle pauses around magical or emotional moments
        .replace(
          /\b(magic|magical|wonder|wonderful|dream|dreaming|gentle|soft|quiet|peaceful|cozy|warm)\b/gi,
          "... $1 ..."
        )
        // Slightly elongate vowel sounds in key words (represented as repeated letters)
        .replace(/\b(ooh|ahh|wow)\b/gi, "$1h")
        // Add pauses around transitional phrases
        .replace(
          /\b(suddenly|meanwhile|then|next|finally|at last)\b/gi,
          "... $1 ..."
        )
        // Clean up excessive pauses
        .replace(/\.{4,}/g, "...")
        .replace(/\s+/g, " ")
        .trim()
    );
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
