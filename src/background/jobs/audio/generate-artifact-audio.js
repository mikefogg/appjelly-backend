import { Artifact, ArtifactPage } from "#src/models/index.js";
import { queueBatchPageAudio } from "#src/background/queues/image-queue.js";

export default async function generateArtifactAudioJob(job) {
  const { artifactId, voice, speed } = job.data;

  try {
    console.log(`[Generate Artifact Audio] Starting audio generation for artifact ${artifactId}`);

    // Get the artifact with its pages
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

    console.log(`[Generate Artifact Audio] Found artifact "${artifact.title}" with ${artifact.pages.length} pages`);

    // Filter pages that have text content - text is stored in layout_data.text as an array
    const pagesWithText = artifact.pages.filter(page => {
      if (page.layout_data && page.layout_data.text && Array.isArray(page.layout_data.text)) {
        return page.layout_data.text.length > 0 && page.layout_data.text.some(text => text.trim() !== '');
      }
      // Fallback to page.text if it exists
      return page.text && page.text.trim() !== '';
    });
    
    if (pagesWithText.length === 0) {
      console.log(`[Generate Artifact Audio] Debug: First few pages structure:`);
      artifact.pages.slice(0, 3).forEach((page, index) => {
        console.log(`  Page ${page.page_number}:`);
        console.log(`    layout_data.text type: ${Array.isArray(page.layout_data?.text) ? 'Array' : typeof page.layout_data?.text}`);
        console.log(`    layout_data.text length: ${page.layout_data?.text?.length || 0}`);
        console.log(`    layout_data.text sample: ${JSON.stringify(page.layout_data?.text?.slice(0, 2))}`);
      });
      throw new Error(`Artifact ${artifactId} has no pages with text content`);
    }

    console.log(`[Generate Artifact Audio] ${pagesWithText.length} pages have text content`);

    // Queue audio generation for each page
    const queuedJobs = await queueBatchPageAudio(
      pagesWithText.map(page => ({
        id: page.id,
        artifact_id: artifactId
      })),
      {
        voice: voice || 'nova',
        speed: speed || 1.0,
        staggerDelay: 3000, // 3 seconds between each page to avoid rate limits
      }
    );

    console.log(`[Generate Artifact Audio] Queued ${queuedJobs.length} audio generation jobs`);

    return {
      success: true,
      artifactId: artifact.id,
      artifactTitle: artifact.title,
      totalPages: artifact.pages.length,
      pagesWithText: pagesWithText.length,
      queuedJobs: queuedJobs.length,
      voice: voice || 'nova',
      speed: speed || 1.0,
    };

  } catch (error) {
    console.error(`[Generate Artifact Audio] Error generating audio for artifact ${artifactId}:`, error);
    throw error;
  }
}