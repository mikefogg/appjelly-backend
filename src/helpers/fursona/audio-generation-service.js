import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

class FursonaAudioGenerationService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Cloudflare R2 configuration
    this.r2AccountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
    this.r2ApiKey = process.env.CLOUDFLARE_R2_API_KEY;
    this.r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME?.replace(/['";]/g, '');
    this.r2PublicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/['";]/g, '');

    // Audio configuration
    this.audioModel = "gpt-4o-mini-tts"; // Uses the model that supports instructions
    this.audioFormat = "mp3";

    // Voice presets for pet inner monologues
    this.voicePresets = {
      italianChef: {
        voice: "sage", // Using nova as base voice
        instructions: `Affect/Personality: An exuberant Italian chef, describing the night's dinner specials to an English-speaking table.
                      Tone: Passionate about the quality and the ingredients of the food; persuasive about what the table should order.
                      Pronunciation: Pronounce these words in Italian ("buonissima sera," "bruschetta al pomodoro," "semplice e perfetto," "ossobuco alla milanese," "risotto allo zafferano," "belissimo," "torta della nonna," "mangia bene" and "buon appetito." All of the other words should be in English with an Italian accent.
                      Emotion: Warm, exuberant, and patient to ensure the tourist feels understood and guided throughout the interaction.`,
        description: "Exuberant Italian chef personality for pet inner voices",
      },
      default: {
        voice: "sage",
        instructions: null,
        description: "Default voice for pet monologues",
      },
    };

    // Default to Italian chef preset for fursona
    this.defaultPreset = "italianChef";

    // Local audio storage directory
    this.audioDir = path.join(process.cwd(), "storage", "audio", "fursona");

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
      console.log(
        `[Fursona Audio Storage] Created directory: ${this.audioDir}`
      );
    }
  }

  /**
   * Calculate cost for audio generation API usage
   * @param {number} characterCount - Number of characters in the input text
   * @returns {number} Cost in USD
   */
  calculateAudioCost(characterCount) {
    // OpenAI TTS pricing (as of 2024)
    const costPerChar = 0.015 / 1000; // $0.015 per 1K characters for gpt-4o-mini-tts
    const cost = characterCount * costPerChar;

    console.log(
      `[Fursona Audio Cost] ${characterCount} characters at $${costPerChar.toFixed(
        6
      )} per char = $${cost.toFixed(4)}`
    );
    return cost;
  }

  /**
   * Generate audio for pet inner monologue with Italian chef personality
   * @param {string} monologueText - The pet's inner monologue text
   * @param {Object} options - Additional options
   * @returns {Object} Generated audio info with file path
   */
  async generateMonologueAudio(monologueText, options = {}) {
    try {
      const startTime = Date.now();
      const preset = this.voicePresets[this.defaultPreset];

      console.log(
        `[Fursona Audio] Generating audio for ${monologueText.length} characters...`
      );
      console.log(
        `[Fursona Audio] Using voice: ${preset.voice}, model: ${this.audioModel}`
      );
      console.log(`[Fursona Audio] Voice preset: ${this.defaultPreset}`);
      console.log(
        `[Fursona Audio] Text preview: "${monologueText.substring(0, 100)}${
          monologueText.length > 100 ? "..." : ""
        }"`
      );

      // Prepare the API call parameters with Italian chef instructions
      const apiParams = {
        model: this.audioModel,
        voice: preset.voice,
        input: monologueText,
        response_format: this.audioFormat,
        speed: options.speed || 1.0,
        instructions: preset.instructions,
      };

      console.log(
        `[Fursona Audio] Using Italian chef voice instructions for pet personality`
      );

      // Generate audio using OpenAI TTS
      const response = await this.openai.audio.speech.create(apiParams);

      // Generate unique filename
      const timestamp = Date.now();
      const filename = `fursona-monologue-${timestamp}.${this.audioFormat}`;
      const filePath = path.join(this.audioDir, filename);

      // Save audio to local file (delete if exists first)
      const buffer = Buffer.from(await response.arrayBuffer());
      try {
        await fs.unlink(filePath);
        console.log(`[Fursona Audio] Deleted existing file: ${filename}`);
      } catch (error) {
        // File doesn't exist, that's fine
      }
      await fs.writeFile(filePath, buffer);

      const endTime = Date.now();
      const generationTime = (endTime - startTime) / 1000;
      const audioSize = buffer.length;

      // Calculate cost
      const generationCost = this.calculateAudioCost(monologueText.length);

      console.log(`[Fursona Audio] Created audio file: ${filename}`);
      console.log(
        `[Fursona Audio] Size: ${audioSize} bytes, Duration: ${generationTime.toFixed(
          2
        )}s`
      );
      console.log(`[Fursona Audio] Cost: $${generationCost.toFixed(4)}`);

      // Upload to Cloudflare R2
      const r2Key = `fursona/audio/${filename}`;
      let r2Url = null;
      
      try {
        r2Url = await this.uploadToR2(buffer, r2Key);
        console.log(`[Fursona Audio] Audio uploaded to R2: ${r2Url}`);
      } catch (error) {
        console.warn(`[Fursona Audio] R2 upload failed, using local file: ${error.message}`);
        r2Url = `${this.r2PublicUrl}/${r2Key}`; // Fallback URL
      }

      // Calculate approximate audio duration (characters per second for speech)
      const averageCharsPerSecond = 12; // Balanced speaking rate
      const estimatedDuration = Math.ceil(monologueText.length / averageCharsPerSecond);

      return {
        filename,
        file_path: filePath,
        r2_key: r2Key,
        r2_url: r2Url,
        text_used: monologueText,
        character_count: monologueText.length,
        generation_cost: generationCost,
        generation_time: generationTime,
        audio_size_bytes: audioSize,
        duration_seconds: estimatedDuration,
        voice: preset.voice,
        voice_preset: this.defaultPreset,
        model: this.audioModel,
        format: this.audioFormat,
        speed: options.speed || 1.0,
        instructions_used: preset.instructions,
      };
    } catch (error) {
      console.error(`[Fursona Audio] Error generating audio:`, error);
      throw error;
    }
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
      console.log(`[Fursona Audio Storage] Deleted file: ${filename}`);
      return true;
    } catch (error) {
      console.error(
        `[Fursona Audio Storage] Error deleting file ${filename}:`,
        error
      );
      return false;
    }
  }
  /**
   * Upload audio buffer to Cloudflare R2
   * @param {Buffer} audioBuffer - Audio data buffer
   * @param {string} key - R2 object key
   * @returns {string} Public URL to the uploaded audio
   */
  async uploadToR2(audioBuffer, key) {
    try {
      // Use the correct Cloudflare R2 REST API endpoint
      const url = `https://api.cloudflare.com/client/v4/accounts/${this.r2AccountId}/r2/buckets/${this.r2BucketName}/objects/${key}`;
      
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.r2ApiKey}`,
          'Content-Type': 'audio/mpeg',
        },
        body: audioBuffer,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`R2 upload failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Return public URL
      const publicUrl = `${this.r2PublicUrl}/${key}`;
      console.log(`[Fursona Audio] Successfully uploaded to R2: ${publicUrl}`);
      
      return publicUrl;
    } catch (error) {
      console.error('[Fursona Audio] Error uploading to R2:', error);
      throw error;
    }
  }
}

export default new FursonaAudioGenerationService();
