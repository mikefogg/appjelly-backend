import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FursonaVideoGenerationService {
  constructor() {
    this.remotionDir = path.join(__dirname, "../../../src/remotion/fursona");
    this.outputDir = path.join(process.cwd(), "storage", "videos", "saywut");

    // Ensure output directory exists
    this.ensureOutputDirectory();
  }

  /**
   * Ensure the video output directory exists
   */
  async ensureOutputDirectory() {
    try {
      await fs.access(this.outputDir);
    } catch (error) {
      await fs.mkdir(this.outputDir, { recursive: true });
      console.log(
        `[Fursona Video] Created output directory: ${this.outputDir}`
      );
    }
  }

  /**
   * Generate a video from artifact data
   * @param {Object} params - Video generation parameters
   * @param {string} params.artifactId - Artifact ID
   * @param {string} params.imageUrl - URL of the pet image
   * @param {string} params.audioFilePath - Local path to audio file
   * @param {string} params.text - Pet inner monologue text
   * @param {number} params.durationInSeconds - Video duration (default 10)
   * @returns {Object} Generated video info
   */
  async generateVideo({
    artifactId,
    imageUrl,
    audioFilePath,
    audioUrl,
    text,
    durationInSeconds = 10,
    audioDurationSeconds = null,
  }) {
    try {
      const startTime = Date.now();

      // Generate unique filename
      const timestamp = Date.now();
      const outputFilename = `fursona-${artifactId}-${timestamp}.mp4`;
      const outputPath = path.join(this.outputDir, outputFilename);

      console.log(
        `[Fursona Video] Starting video generation for artifact ${artifactId}`
      );
      console.log(`[Fursona Video] Image URL: ${imageUrl}`);
      console.log(`[Fursona Video] Audio file: ${audioFilePath}`);
      console.log(`[Fursona Video] Text length: ${text.length} characters`);

      // Use audio duration if available, otherwise use specified duration
      const actualDuration = audioDurationSeconds
        ? Math.ceil(audioDurationSeconds)
        : durationInSeconds;

      // Add buffer padding (1 second on each side for intro/outro)
      const paddedDuration = actualDuration + 2;

      // Calculate duration in frames (30 fps)
      const durationInFrames = paddedDuration * 30;
      const audioDurationInFrames = actualDuration * 30;

      // Generate speech-to-text alignment if audio is available
      let wordTimings = null;
      let timingMetadata = null;
      if (audioFilePath || audioUrl) {
        try {
          const { default: speechAlignmentService } = await import(
            "./speech-alignment-service.js"
          );
          const alignmentResult =
            await speechAlignmentService.generateWordTimestamps(
              audioFilePath || audioUrl,
              text
            );

          // Convert to frame timing
          wordTimings = speechAlignmentService.convertToFrameTiming(
            alignmentResult.words,
            30
          );
          timingMetadata = alignmentResult.metadata;

          console.log(
            `[Fursona Video] Generated ${wordTimings.length} word timings using ${timingMetadata.provider}`
          );
          console.log(
            `[Fursona Video] Timing generation cost: $${timingMetadata.api_cost_usd.toFixed(
              4
            )}`
          );
        } catch (error) {
          console.warn(
            "[Fursona Video] Speech alignment failed, using fallback:",
            error.message
          );
        }
      }

      console.log(`[Fursona Video] Using render-video.js script...`);

      // Use the existing render-video.js script with proper arguments
      const scriptPath = path.join(this.remotionDir, "render-video.js");
      const args = [
        scriptPath,
        "--image",
        imageUrl || "null",
        "--text",
        text,
        "--output",
        outputPath,
        "--duration",
        paddedDuration.toString(),
      ];

      // Add audio argument if available (prefer R2 URL over local file)
      if (audioUrl) {
        args.push("--audio-url", audioUrl);
      } else if (audioFilePath) {
        args.push("--audio", audioFilePath);
      }

      // Upload word timings to R2 if available
      let wordTimingsData = null;
      if (wordTimings) {
        try {
          wordTimingsData = await this.uploadWordTimingsToR2(
            wordTimings,
            artifactId
          );
          console.log(
            `[Fursona Video] Uploaded word timings to R2: ${wordTimingsData.key}`
          );
        } catch (error) {
          console.warn(
            "[Fursona Video] Failed to upload word timings to R2:",
            error.message
          );
        }
      }

      // Add word timings URL if available
      if (wordTimingsData?.url) {
        args.push("--word-timings-url", wordTimingsData.url);
      }

      try {
        // Build command with proper shell escaping for complex text
        const escapeShellArg = (arg) => {
          // For arguments containing quotes, use single quotes and escape any single quotes
          if (arg.includes('"')) {
            return `'${arg.replace(/'/g, "'\"'\"'")}'`;
          }
          // For simple arguments, use double quotes with basic escaping
          return `"${arg.replace(/"/g, '\\"')}"`;
        };

        const quotedArgs = args.map(escapeShellArg);
        const command = `cd "${this.remotionDir}" && node ${quotedArgs.join(
          " "
        )}`;

        console.log(`[Fursona Video] Running: ${command}`);

        // Use execSync which works better with dotenvx environment
        execSync(command, {
          stdio: "inherit",
          env: {
            ...process.env,
            NODE_ENV: "production",
          },
          shell: true,
        });

        console.log(`[Fursona Video] Video generation completed`);
      } catch (renderError) {
        console.error(`[Fursona Video] Render error:`, renderError.message);
        throw renderError;
      }

      // Get file stats
      const stats = await fs.stat(outputPath);
      const endTime = Date.now();
      const generationTime = (endTime - startTime) / 1000;

      console.log(
        `[Fursona Video] Video generated successfully: ${outputFilename}`
      );
      console.log(
        `[Fursona Video] Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
      );
      console.log(
        `[Fursona Video] Generation time: ${generationTime.toFixed(2)}s`
      );

      // Check if we should use local storage instead of R2
      const useLocalStorage = process.env.LOCAL_STORAGE === "true";
      
      let r2VideoData = null;
      let localVideoPath = null;
      
      if (useLocalStorage) {
        // Keep video locally
        console.log(`[Fursona Video] LOCAL_STORAGE=true, keeping video locally`);
        localVideoPath = `/storage/videos/fursona/${outputFilename}`;
        console.log(`[Fursona Video] Local video path: ${localVideoPath}`);
      } else {
        // Upload video to R2
        console.log(`[Fursona Video] Uploading video to R2...`);
        const videoBuffer = await fs.readFile(outputPath);
        r2VideoData = await this.uploadVideoToR2(videoBuffer, artifactId);

        console.log(`[Fursona Video] Video uploaded to R2: ${r2VideoData.key}`);

        // Clean up local file after successful upload
        try {
          await fs.unlink(outputPath);
          console.log(`[Fursona Video] Cleaned up local file: ${outputFilename}`);
        } catch (cleanupError) {
          console.warn(
            `[Fursona Video] Failed to cleanup local file: ${cleanupError.message}`
          );
        }
      }

      return {
        filename: outputFilename,
        file_path: useLocalStorage ? outputPath : null,
        local_path: localVideoPath,
        size_bytes: stats.size,
        duration_seconds: actualDuration,
        duration_frames: durationInFrames,
        audio_duration_frames: audioDurationInFrames,
        fps: 30,
        width: 1080,
        height: 1920,
        generation_time: generationTime,
        artifact_id: artifactId,
        // R2 video data (null if using local storage)
        r2_key: r2VideoData?.key || null,
        r2_url: r2VideoData?.url || null,
        // Include timing data for storage
        timing_data: wordTimingsData
          ? {
              key: wordTimingsData.key,
              url: wordTimingsData.url,
              metadata: timingMetadata,
            }
          : null,
      };
    } catch (error) {
      console.error(`[Fursona Video] Error generating video:`, error);
      throw error;
    }
  }

  /**
   * Generate video from an artifact with all its media
   * @param {Object} artifact - Artifact with metadata, media relations
   * @returns {Object} Generated video info
   */
  async generateVideoFromArtifact(artifact) {
    try {
      // Extract necessary data from artifact
      const monologueText =
        artifact.metadata?.monologue_text || artifact.description;
      if (!monologueText) {
        throw new Error("No monologue text found in artifact");
      }

      // Get the first media image
      const imageMedia = artifact.media?.find((m) => m.media_type === "image");
      if (!imageMedia) {
        throw new Error("No image media found for artifact");
      }

      // Get the audio media
      const audioMedia = artifact.media?.find((m) => m.media_type === "audio");

      // Convert image key to URL (assuming Cloudflare Images)
      const imageUrl = this.getCloudflareImageUrl(imageMedia.image_key);

      // Generate video
      return await this.generateVideo({
        artifactId: artifact.id,
        imageUrl,
        audioFilePath: audioMedia?.metadata?.file_path || null,
        text: monologueText,
        durationInSeconds: 10, // Default 10 second videos
      });
    } catch (error) {
      console.error(
        `[Fursona Video] Error generating video from artifact:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get signed Cloudflare Images URL from image key
   * @param {string} imageKey - Cloudflare image key
   * @returns {string} Signed image URL
   */
  async getCloudflareImageUrl(imageKey) {
    const { default: mediaService } = await import("../media-service.js");
    return mediaService.generateLocalSignedUrl(imageKey, "public", 60); // 60 min expiry
  }

  /**
   * Upload word timings JSON to R2 for permanent storage
   * @param {Array} wordTimings - Array of word timing objects
   * @param {string} artifactId - Artifact ID for unique filename
   * @returns {Object} R2 key and URL
   */
  async uploadWordTimingsToR2(wordTimings, artifactId) {
    try {
      // Create unique filename for permanent storage
      const timestamp = Date.now();
      const r2Key = `fursona/audio-timings/${artifactId}-${timestamp}.json`;

      // Convert timings to JSON
      const timingsJson = JSON.stringify(wordTimings, null, 2);

      // Upload to R2 using Cloudflare R2 REST API (same pattern as audio service)
      const r2AccountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
      const r2ApiKey = process.env.CLOUDFLARE_R2_API_KEY;
      const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME?.replace(
        /['";]/g,
        ""
      );
      const r2PublicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(
        /['";]/g,
        ""
      );

      const url = `https://api.cloudflare.com/client/v4/accounts/${r2AccountId}/r2/buckets/${r2BucketName}/objects/${r2Key}`;

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${r2ApiKey}`,
          "Content-Type": "application/json",
        },
        body: timingsJson,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `R2 upload failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      // Return both key and URL
      return {
        key: r2Key,
        url: `${r2PublicUrl}/${r2Key}`,
      };
    } catch (error) {
      console.error(
        "[Fursona Video] Failed to upload word timings to R2:",
        error
      );
      throw error;
    }
  }

  /**
   * Upload video to R2 for permanent storage
   * @param {Buffer} videoBuffer - Video file buffer
   * @param {string} artifactId - Artifact ID for unique filename
   * @returns {Object} R2 key and URL
   */
  async uploadVideoToR2(videoBuffer, artifactId) {
    try {
      // Create unique filename for permanent storage
      const timestamp = Date.now();
      const r2Key = `fursona/videos/${artifactId}-${timestamp}.mp4`;

      // Upload to R2 using Cloudflare R2 REST API (same pattern as audio/timings)
      const r2AccountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
      const r2ApiKey = process.env.CLOUDFLARE_R2_API_KEY;
      const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME?.replace(
        /['";]/g,
        ""
      );
      const r2PublicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(
        /['";]/g,
        ""
      );

      const url = `https://api.cloudflare.com/client/v4/accounts/${r2AccountId}/r2/buckets/${r2BucketName}/objects/${r2Key}`;

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${r2ApiKey}`,
          "Content-Type": "video/mp4",
        },
        body: videoBuffer,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `R2 upload failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      // Return both key and URL
      return {
        key: r2Key,
        url: `${r2PublicUrl}/${r2Key}`,
      };
    } catch (error) {
      console.error("[Fursona Video] Failed to upload video to R2:", error);
      throw error;
    }
  }

  /**
   * Delete word timings file from R2
   * @param {string} wordTimingsUrl - R2 URL of the word timings file
   * @returns {boolean} Success status
   */
  async deleteWordTimingsFromR2(wordTimingsUrl) {
    try {
      // Extract filename from URL
      const url = new URL(wordTimingsUrl);
      const filename = url.pathname.substring(1); // Remove leading slash

      // Delete from R2 using AWS SDK
      const AWS = await import("aws-sdk");
      const s3 = new AWS.default.S3({
        endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
        accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        region: "auto",
        signatureVersion: "v4",
      });

      await s3
        .deleteObject({
          Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME,
          Key: filename,
        })
        .promise();

      console.log(
        `[Fursona Video] Deleted word timings file from R2: ${filename}`
      );
      return true;
    } catch (error) {
      console.error(
        `[Fursona Video] Failed to delete word timings from R2:`,
        error
      );
      return false;
    }
  }

  /**
   * Delete video file
   * @param {string} filename - Video filename to delete
   * @returns {boolean} Success status
   */
  async deleteVideoFile(filename) {
    try {
      const filePath = path.join(this.outputDir, filename);
      await fs.unlink(filePath);
      console.log(`[Fursona Video] Deleted file: ${filename}`);
      return true;
    } catch (error) {
      console.error(`[Fursona Video] Error deleting file ${filename}:`, error);
      return false;
    }
  }

  /**
   * Get video file info
   * @param {string} filename - Video filename
   * @returns {Object} File information
   */
  async getVideoFileInfo(filename) {
    try {
      const filePath = path.join(this.outputDir, filename);
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
}

export default new FursonaVideoGenerationService();
