import { Artifact, Media } from "#src/models/index.js";
import { audioGenerationService } from "#src/helpers/index.js";

export default async function generateStoryAudioJob(job) {
  const { artifactId, voice, speed } = job.data;

  try {
    console.log(`[Generate Story Audio] Starting single audio generation for artifact ${artifactId}`);

    // Get the artifact with its pages ordered by page number
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched('[pages(orderByPageNumber)]')
      .modifiers({
        orderByPageNumber: (builder) => {
          builder.orderBy('page_number', 'asc');
        }
      });
      
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    if (!artifact.pages || artifact.pages.length === 0) {
      throw new Error(`Artifact ${artifactId} has no pages`);
    }

    console.log(`[Generate Story Audio] Found artifact "${artifact.title}" with ${artifact.pages.length} pages`);

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
        console.log(`[Generate Story Audio] Page ${page.page_number}: ${pageText.length} characters`);
      }
    }

    if (storyText.length === 0) {
      throw new Error(`Artifact ${artifactId} has no pages with text content`);
    }

    // Join all page text with natural pauses between pages
    const combinedText = storyText.join(' ... '); // Add pause between pages
    
    console.log(`[Generate Story Audio] Combined ${storyText.length} pages into ${combinedText.length} characters`);
    console.log(`[Generate Story Audio] Text preview: "${combinedText.substring(0, 200)}..."`);

    // Generate the complete story audio
    const audioResult = await audioGenerationService.generateAudio(
      combinedText,
      voice || 'nova',
      {
        speed: speed || 1.0,
      }
    );

    console.log(`[Generate Story Audio] Audio generated: ${audioResult.filename}, Cost: $${audioResult.generation_cost.toFixed(4)}`);

    // Create media record for the story audio
    const audioMedia = await Media.createAudioForArtifact(artifactId, audioResult, {
      artifact_id: artifactId,
      pages_combined: storyText.length,
      story_title: artifact.title,
      voice_preset: audioResult.voice_preset,
      instructions_used: audioResult.instructions_used,
    });

    console.log(`[Generate Story Audio] Created media record ${audioMedia.id} for artifact ${artifactId}`);

    console.log(`[Generate Story Audio] Successfully generated story audio: ${audioResult.filename}`);

    return {
      success: true,
      artifactId: artifact.id,
      artifactTitle: artifact.title,
      mediaId: audioMedia.id,
      audioFilename: audioResult.filename,
      generationCost: audioResult.generation_cost,
      audioSizeBytes: audioResult.audio_size_bytes,
      characterCount: audioResult.character_count,
      pagesCombined: storyText.length,
      voice: audioResult.voice,
      voicePreset: audioResult.voice_preset,
    };

  } catch (error) {
    console.error(`[Generate Story Audio] Error generating story audio for artifact ${artifactId}:`, error);
    throw error;
  }
}