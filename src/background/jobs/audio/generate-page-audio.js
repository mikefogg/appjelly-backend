import { ArtifactPage, Media } from "#src/models/index.js";
import { audioGenerationService } from "#src/helpers/index.js";

export default async function generatePageAudioJob(job) {
  const { pageId, artifactId, voice, speed } = job.data;

  try {
    console.log(`[Generate Page Audio] Starting audio generation for page ${pageId}`);

    // Get the page with text content
    let page = await ArtifactPage.query().findById(pageId);
      
    if (!page) {
      throw new Error(`Page ${pageId} not found`);
    }

    // Extract text content - it's stored as an array of sentences in layout_data.text
    let pageText = '';
    
    if (page.layout_data && page.layout_data.text && Array.isArray(page.layout_data.text)) {
      // Join the array of sentences into a single string
      pageText = page.layout_data.text.join(' ');
    } else if (page.text && Array.isArray(page.text)) {
      // Fallback: check if page.text is also an array
      pageText = page.text.join(' ');
    } else if (typeof page.text === 'string') {
      // Fallback: use page.text if it's a string
      pageText = page.text;
    }

    console.log(`[Generate Page Audio] Found page ${page.page_number}`);
    console.log(`[Generate Page Audio] Raw layout_data.text:`, page.layout_data?.text);
    console.log(`[Generate Page Audio] Text array length:`, page.layout_data?.text?.length || 0);
    console.log(`[Generate Page Audio] Joined text:`, pageText);

    if (!pageText || pageText.trim() === '') {
      throw new Error(`Page ${pageId} has no text content`);
    }

    console.log(`[Generate Page Audio] Text preview: "${pageText.substring(0, 100)}..."`);

    // Generate the page audio
    const audioResult = await audioGenerationService.generatePageAudio(
      pageText,
      page.page_number,
      {
        voice: voice || 'nova', // Default to Nova voice
        speed: speed || 1.0,    // Default to normal speed
      }
    );

    console.log(`[Generate Page Audio] Audio generated: ${audioResult.filename}, Cost: $${audioResult.generation_cost.toFixed(4)}`);

    // Create media record for the audio
    const audioMedia = await Media.createAudioForPage(pageId, audioResult, {
      artifact_id: artifactId,
      page_number: page.page_number,
    });

    console.log(`[Generate Page Audio] Created media record ${audioMedia.id} for page ${pageId}`);

    console.log(`[Generate Page Audio] Successfully generated audio for page ${page.page_number}: ${audioResult.filename}`);

    return {
      success: true,
      pageId: page.id,
      page_number: page.page_number,
      media_id: audioMedia.id,
      audio_filename: audioResult.filename,
      generation_cost: audioResult.generation_cost,
      audio_size_bytes: audioResult.audio_size_bytes,
      character_count: audioResult.character_count,
    };

  } catch (error) {
    console.error(`[Generate Page Audio] Error generating audio for page ${pageId}:`, error);
    throw error;
  }
}