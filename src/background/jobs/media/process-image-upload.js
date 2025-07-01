import { Media } from "#src/models/index.js";

/**
 * Process image upload completion
 * Updates media status and metadata after successful upload
 */
export default async function processImageUpload(job) {
  const { mediaId, imageKey, metadata } = job.data;

  try {
    console.log(`📸 Processing image upload for media ${mediaId} (${imageKey})`);

    // Find the media record
    const media = await Media.query().findById(mediaId);
    
    if (!media) {
      console.warn(`Media record not found: ${mediaId}`);
      return;
    }

    // Update media metadata with upload completion
    await media.$query().patch({
      metadata: {
        ...media.metadata,
        cloudflare_upload_completed: true,
        upload_processed_at: new Date().toISOString(),
        processing_status: "completed",
        ...(metadata && {
          file_size: metadata.file_size,
          dimensions: metadata.dimensions,
          format: metadata.format,
        }),
      },
    });

    console.log(`✅ Successfully processed image upload: ${imageKey}`);

    return {
      success: true,
      mediaId,
      imageKey,
      processedAt: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`❌ Failed to process image upload for ${mediaId}:`, error);
    throw error;
  }
}