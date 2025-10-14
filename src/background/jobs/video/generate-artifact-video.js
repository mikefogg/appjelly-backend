import { Artifact, Media } from "#src/models/index.js";
import fursonaVideoService from "#src/helpers/fursona/video-generation-service.js";

export default async function generateArtifactVideoJob(job) {
  const { artifactId } = job.data;

  try {
    console.log(`[Generate Artifact Video] Starting video generation for artifact ${artifactId}`);

    // Get the artifact with its app and media
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched('[app, media]');
      
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    const appSlug = artifact.app?.slug;
    console.log(`[Generate Artifact Video] App: ${appSlug}, Artifact type: ${artifact.artifact_type}`);

    // Currently only support fursona videos
    if (appSlug !== "saywut") {
      throw new Error(`Video generation not supported for app: ${appSlug}`);
    }

    // Get required media
    const imageMedia = artifact.media?.find(m => m.media_type === 'image' && m.owner_type === 'input');
    const audioMedia = artifact.media?.find(m => m.media_type === 'audio' && m.owner_type === 'artifact');

    if (!audioMedia) {
      throw new Error(`No audio media found for artifact ${artifactId}`);
    }

    // Get monologue text
    const monologueText = artifact.metadata?.monologue_text || artifact.description;
    if (!monologueText) {
      throw new Error(`No monologue text found for artifact ${artifactId}`);
    }

    console.log(`[Generate Artifact Video] Found image: ${imageMedia ? imageMedia.image_key : 'none (using black background)'}`);
    console.log(`[Generate Artifact Video] Found audio: ${audioMedia.metadata?.filename}`);
    console.log(`[Generate Artifact Video] Text length: ${monologueText.length} characters`);

    // Generate the video
    const imageUrl = imageMedia ? fursonaVideoService.getCloudflareImageUrl(imageMedia.image_key) : null;
    const audioFilePath = audioMedia.metadata?.file_path;

    const videoResult = await fursonaVideoService.generateVideo({
      artifactId,
      imageUrl,
      audioFilePath,
      text: monologueText,
      durationInSeconds: Math.ceil((audioMedia.metadata?.audio_size_bytes || 100000) / 10000), // Estimate duration based on file size
    });

    console.log(`[Generate Artifact Video] Video generated: ${videoResult.filename}, Size: ${(videoResult.size_bytes / 1024 / 1024).toFixed(2)} MB`);

    // Check if we're using local storage
    const useLocalStorage = process.env.LOCAL_STORAGE === "true";
    
    // Create media record for the video
    const videoMedia = await Media.query().insert({
      owner_type: 'artifact',
      owner_id: artifactId,
      media_type: 'video',
      video_key: useLocalStorage ? null : videoResult.r2_key,
      metadata: {
        ...videoResult,
        app_slug: appSlug,
        content_type: 'monologue',
        title: artifact.title,
        source_image_id: imageMedia?.id || null,
        source_audio_id: audioMedia.id,
        monologue_preview: monologueText.substring(0, 100),
        // Add local storage info if applicable
        ...(useLocalStorage && {
          local_storage: true,
          local_path: videoResult.local_path,
          file_path: videoResult.file_path
        })
      },
      status: 'completed',
    });

    console.log(`[Generate Artifact Video] Created media record ${videoMedia.id} for artifact ${artifactId}`);
    console.log(`[Generate Artifact Video] Successfully generated video: ${videoResult.filename}`);

    // Update artifact metadata
    await artifact.$query().patch({
      metadata: {
        ...artifact.metadata,
        has_video: true,
        video_media_id: videoMedia.id,
        video_generated_at: new Date().toISOString(),
      },
    });

    return {
      success: true,
      artifactId: artifact.id,
      artifactTitle: artifact.title,
      mediaId: videoMedia.id,
      videoFilename: videoResult.filename,
      videoSizeBytes: videoResult.size_bytes,
      videoDurationSeconds: videoResult.duration_seconds,
      generationTime: videoResult.generation_time,
      appSlug: appSlug,
      contentType: 'monologue'
    };

  } catch (error) {
    console.error(`[Generate Artifact Video] Error generating video for artifact ${artifactId}:`, error);
    
    // Update artifact with error status
    if (artifactId) {
      try {
        const failedArtifact = await Artifact.query().findById(artifactId);
        if (failedArtifact) {
          await failedArtifact.$query().patch({
            metadata: {
              ...failedArtifact.metadata,
              video_generation_error: error.message,
              video_generation_failed_at: new Date().toISOString(),
            },
          });
        }
      } catch (updateError) {
        console.error(`[Generate Artifact Video] Failed to update artifact metadata:`, updateError);
      }
    }
    
    throw error;
  }
}