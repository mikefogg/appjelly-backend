import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SpeechAlignmentService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generate word-level timestamps for audio using OpenAI Whisper API
   * @param {string} audioFilePath - Path to audio file
   * @param {string} originalText - Original text to align with
   * @returns {Array} Array of word objects with timestamps
   */
  async generateWordTimestamps(audioFilePath, originalText) {
    try {
      console.log('[Speech Alignment] Using OpenAI Whisper API for transcription...');
      
      // Read the audio file
      const audioFile = await fs.readFile(audioFilePath);
      
      // Create a File object for the API
      const file = new File([audioFile], path.basename(audioFilePath), {
        type: this.getAudioMimeType(audioFilePath)
      });
      
      // Call OpenAI Whisper API with word-level timestamps
      const startTime = Date.now();
      const transcription = await this.openai.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
        language: 'en'
      });
      const endTime = Date.now();
      
      // Calculate cost and timing
      const durationSeconds = transcription.duration || 0;
      const apiCost = this.calculateWhisperCost(durationSeconds);
      const processingTime = (endTime - startTime) / 1000;
      
      // Extract word timestamps from API response
      const wordTimestamps = this.extractWordTimestampsFromAPI(transcription, originalText);
      
      console.log(`[Speech Alignment] Generated ${wordTimestamps.length} word timestamps`);
      console.log(`[Speech Alignment] Audio duration: ${durationSeconds}s, Cost: $${apiCost.toFixed(4)}, Processing time: ${processingTime.toFixed(2)}s`);
      
      return {
        words: wordTimestamps,
        metadata: {
          duration_seconds: durationSeconds,
          processing_time_seconds: processingTime,
          api_cost_usd: apiCost,
          transcription_text: transcription.text,
          model: 'whisper-1',
          provider: 'openai'
        }
      };
      
    } catch (error) {
      console.error('[Speech Alignment] OpenAI Whisper API failed:', error.message);
      const fallbackWords = this.generateFallbackTimestamps(originalText);
      return {
        words: fallbackWords,
        metadata: {
          duration_seconds: 0,
          processing_time_seconds: 0,
          api_cost_usd: 0,
          transcription_text: originalText,
          model: 'fallback',
          provider: 'internal'
        }
      };
    }
  }

  /**
   * Get MIME type for audio file
   * @param {string} filePath - Path to audio file
   * @returns {string} MIME type
   */
  getAudioMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.flac': 'audio/flac',
      '.webm': 'audio/webm',
      '.ogg': 'audio/ogg'
    };
    return mimeTypes[ext] || 'audio/mpeg';
  }

  /**
   * Calculate OpenAI Whisper API cost
   * @param {number} durationSeconds - Audio duration in seconds
   * @returns {number} Cost in USD
   */
  calculateWhisperCost(durationSeconds) {
    // OpenAI Whisper API pricing: $0.006 per minute
    const pricePerMinute = 0.006;
    const durationMinutes = durationSeconds / 60;
    return durationMinutes * pricePerMinute;
  }

  /**
   * Extract word timestamps from OpenAI Whisper API response
   * @param {Object} transcription - OpenAI API response
   * @param {string} originalText - Original text to match
   * @returns {Array} Word timestamps
   */
  extractWordTimestampsFromAPI(transcription, originalText) {
    const words = [];
    
    // OpenAI API response has word-level timestamps in the words array
    if (transcription.words && transcription.words.length > 0) {
      transcription.words.forEach(wordData => {
        words.push({
          word: wordData.word.trim(),
          start: wordData.start,
          end: wordData.end,
          confidence: 1.0 // OpenAI API doesn't provide confidence scores
        });
      });
    }
    
    // If no word-level data, fall back to segment-level
    if (words.length === 0) {
      console.warn('[Speech Alignment] No word-level timestamps from API, using fallback');
      return this.generateFallbackTimestamps(originalText);
    }
    
    return words;
  }

  /**
   * Generate fallback timestamps when Whisper isn't available
   * @param {string} text - Text to generate timestamps for
   * @returns {Array} Fallback word timestamps
   */
  generateFallbackTimestamps(text) {
    const words = text.split(' ');
    const averageWPM = 150; // Average words per minute for speech
    const secondsPerWord = 60 / averageWPM;
    
    return words.map((word, index) => ({
      word: word.trim(),
      start: index * secondsPerWord + 1, // Add 1 second buffer
      end: (index + 1) * secondsPerWord + 1,
      confidence: 0.5, // Lower confidence for fallback
      fallback: true
    }));
  }

  /**
   * Convert word timestamps to frame-based timing for Remotion
   * @param {Array} wordTimestamps - Word timestamps in seconds
   * @param {number} fps - Frames per second (default 30)
   * @returns {Array} Frame-based word timing
   */
  convertToFrameTiming(wordTimestamps, fps = 30) {
    return wordTimestamps.map(word => ({
      word: word.word,
      startFrame: Math.round(word.start * fps),
      endFrame: Math.round(word.end * fps),
      confidence: word.confidence,
      fallback: word.fallback || false
    }));
  }

  /**
   * Generate synchronized word timing for video
   * @param {string} audioFilePath - Path to audio file
   * @param {string} text - Text to synchronize
   * @param {number} fps - Video frames per second
   * @returns {Object} Synchronized timing data
   */
  async generateSyncedTiming(audioFilePath, text, fps = 30) {
    console.log('[Speech Alignment] Generating synchronized timing...');
    
    // Get word timestamps from audio
    const wordTimestamps = await this.generateWordTimestamps(audioFilePath, text);
    
    // Convert to frame-based timing
    const frameTiming = this.convertToFrameTiming(wordTimestamps, fps);
    
    // Calculate total duration with buffer
    const maxEndTime = Math.max(...wordTimestamps.map(w => w.end));
    const totalDuration = maxEndTime + 2; // Add 2 second buffer
    
    return {
      words: frameTiming,
      totalDurationSeconds: totalDuration,
      totalFrames: Math.ceil(totalDuration * fps),
      fps,
      method: wordTimestamps.some(w => w.fallback) ? 'fallback' : 'openai-whisper'
    };
  }
}

export default new SpeechAlignmentService();