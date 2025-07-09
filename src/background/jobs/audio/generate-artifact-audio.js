import { Artifact, Media } from "#src/models/index.js";
import snugglebugAudioService from "#src/helpers/snugglebug/audio-generation-service.js";
import fursonaAudioService from "#src/helpers/fursona/audio-generation-service.js";

export default async function generateArtifactAudioJob(job) {
  const { artifactId, voice, speed } = job.data;

  try {
    console.log(`[Generate Artifact Audio] Starting audio generation for artifact ${artifactId}`);

    // Get the artifact with its app and pages (if any)
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched('[app, pages(orderByPageNumber)]')
      .modifiers({
        orderByPageNumber: (builder) => {
          builder.orderBy('page_number', 'asc');
        }
      });
      
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    const appSlug = artifact.app?.slug;
    console.log(`[Generate Artifact Audio] App: ${appSlug}, Artifact type: ${artifact.artifact_type}`);

    let audioResult;
    let textContent;

    if (appSlug === "fursona") {
      // For fursona, generate audio from the monologue text
      if (!artifact.metadata?.monologue_text && !artifact.description) {
        throw new Error(`Artifact ${artifactId} has no monologue text`);
      }

      textContent = artifact.metadata?.monologue_text || artifact.description;
      console.log(`[Generate Artifact Audio] Generating pet monologue audio: ${textContent.length} characters`);
      console.log(`[Generate Artifact Audio] Text preview: "${textContent.substring(0, 100)}..."`);

      // Generate audio with Italian chef personality
      audioResult = await fursonaAudioService.generateMonologueAudio(
        textContent,
        { speed: speed || 1.0 }
      );

      console.log(`[Generate Artifact Audio] Fursona audio generated: ${audioResult.filename}, Cost: $${audioResult.generation_cost.toFixed(4)}`);
    } else {
      // For snugglebug, combine text from all pages
      if (!artifact.pages || artifact.pages.length === 0) {
        throw new Error(`Artifact ${artifactId} has no pages`);
      }

      console.log(`[Generate Artifact Audio] Found story "${artifact.title}" with ${artifact.pages.length} pages`);

      // Extract and combine text from all pages
      const storyText = [];
      let totalCharacters = 0;

      for (const page of artifact.pages) {
        let pageText = '';
        
        if (page.layout_data && page.layout_data.text && Array.isArray(page.layout_data.text)) {
          pageText = page.layout_data.text.join(' ');
        } else if (page.text) {
          pageText = page.text;
        }

        if (pageText.trim()) {
          storyText.push(pageText.trim());
          totalCharacters += pageText.length;
          console.log(`[Generate Artifact Audio] Page ${page.page_number}: ${pageText.length} characters`);
        }
      }

      if (storyText.length === 0) {
        throw new Error(`Artifact ${artifactId} has no pages with text content`);
      }

      // Join all page text with natural pauses between pages
      textContent = storyText.join(' ... '); // Add pause between pages
      
      console.log(`[Generate Artifact Audio] Combined ${storyText.length} pages into ${textContent.length} characters`);
      console.log(`[Generate Artifact Audio] Text preview: "${textContent.substring(0, 200)}..."`);

      // Generate the complete story audio
      audioResult = await snugglebugAudioService.generateAudio(
        textContent,
        voice || 'sage', // Default to sage voice for stories
        {
          speed: speed || 1.0,
        }
      );

      console.log(`[Generate Artifact Audio] Story audio generated: ${audioResult.filename}, Cost: $${audioResult.generation_cost.toFixed(4)}`);
    }

    // Create media record for the audio
    const audioMedia = await Media.createAudioForArtifact(artifactId, audioResult, {
      artifact_id: artifactId,
      app_slug: appSlug,
      content_type: appSlug === "fursona" ? "pet_monologue" : "story",
      title: artifact.title,
      voice_preset: audioResult.voice_preset,
      instructions_used: audioResult.instructions_used,
      file_path: audioResult.file_path,
      filename: audioResult.filename,
    });

    console.log(`[Generate Artifact Audio] Created media record ${audioMedia.id} for artifact ${artifactId}`);
    console.log(`[Generate Artifact Audio] Successfully generated audio: ${audioResult.filename}`);

    // For fursona, automatically queue video generation after audio is ready
    if (appSlug === "fursona") {
      try {
        const { videoQueue, JOB_GENERATE_ARTIFACT_VIDEO } = await import("#src/background/queues/index.js");
        
        console.log(`[Generate Artifact Audio] Queueing video generation for fursona artifact ${artifactId}...`);
        
        await videoQueue.add(JOB_GENERATE_ARTIFACT_VIDEO, {
          artifactId: artifactId,
        }, {
          priority: 5,
          delay: 3000 // 3 second delay to ensure audio file is written
        });
        
        console.log(`[Generate Artifact Audio] Successfully queued video generation job`);
      } catch (error) {
        console.error(`[Generate Artifact Audio] Failed to queue video generation:`, error);
        // Don't throw - video generation failure shouldn't fail audio generation
      }
    }

    return {
      success: true,
      artifactId: artifact.id,
      artifactTitle: artifact.title,
      mediaId: audioMedia.id,
      audioFilename: audioResult.filename,
      generationCost: audioResult.generation_cost,
      audioSizeBytes: audioResult.audio_size_bytes,
      characterCount: audioResult.character_count,
      voice: audioResult.voice,
      voicePreset: audioResult.voice_preset,
      appSlug: appSlug,
      contentType: appSlug === "fursona" ? "pet_monologue" : "story"
    };

  } catch (error) {
    console.error(`[Generate Artifact Audio] Error generating audio for artifact ${artifactId}:`, error);
    throw error;
  }
}