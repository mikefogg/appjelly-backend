import { Artifact, Media } from "#src/models/index.js";
import fursonaVideoService from "#src/helpers/fursona/video-generation-service.js";

export default async function generateFursonaVideoJob(job) {
  const { artifactId } = job.data;

  try {
    console.log(`[Generate Fursona Video] Starting video generation for artifact ${artifactId}`);

    // Get the artifact with its media
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched('[media, app]');
      
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    // Verify this is a fursona artifact
    if (artifact.app?.slug !== 'fursona') {
      throw new Error(`Artifact ${artifactId} is not from fursona app`);
    }

    // Check if we have the required media
    const imageMedia = artifact.media?.find(m => m.media_type === 'image');
    const audioMedia = artifact.media?.find(m => m.media_type === 'audio');

    if (!imageMedia) {
      throw new Error(`No image media found for artifact ${artifactId}`);
    }

    console.log(`[Generate Fursona Video] Found image: ${imageMedia.image_key}`);
    console.log(`[Generate Fursona Video] Found audio: ${audioMedia ? audioMedia.metadata?.filename : 'none'}`);

    // Generate the video
    const videoResult = await fursonaVideoService.generateVideoFromArtifact(artifact);

    console.log(`[Generate Fursona Video] Video generated: ${videoResult.filename}`);

    // Create media record for the video
    const videoMedia = await Media.query().insert({
      owner_type: 'artifact',
      owner_id: artifactId,
      media_type: 'video',
      video_key: videoResult.filename, // Store filename as key for now
      metadata: {
        ...videoResult,
        generation_source: 'remotion',
        has_audio: !!audioMedia,
        monologue_preview: artifact.metadata?.monologue_text?.substring(0, 100),
      },
      status: 'completed',
    });

    console.log(`[Generate Fursona Video] Created media record ${videoMedia.id}`);

    // Update artifact metadata to indicate video is ready
    await artifact.$query().patch({
      metadata: {
        ...artifact.metadata,
        has_video: true,
        video_media_id: videoMedia.id,
        video_generated_at: new Date().toISOString(),
      },
    });

    console.log(`[Generate Fursona Video] Successfully generated video for artifact ${artifactId}`);

    return {
      success: true,
      artifactId: artifact.id,
      mediaId: videoMedia.id,
      videoFilename: videoResult.filename,
      videoSizeBytes: videoResult.size_bytes,
      generationTime: videoResult.generation_time,
    };

  } catch (error) {
    console.error(`[Generate Fursona Video] Error generating video for artifact ${artifactId}:`, error);
    
    // Update artifact with error status
    if (artifactId) {
      try {
        await Artifact.query()
          .findById(artifactId)
          .patch({
            metadata: {
              ...((await Artifact.query().findById(artifactId))?.metadata || {}),
              video_generation_error: error.message,
              video_generation_failed_at: new Date().toISOString(),
            },
          });
      } catch (updateError) {
        console.error(`[Generate Fursona Video] Failed to update artifact metadata:`, updateError);
      }
    }
    
    throw error;
  }
}