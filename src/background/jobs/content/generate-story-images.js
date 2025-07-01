import { aiService } from "#src/helpers/index.js";
import { ArtifactPage } from "#src/models/index.js";

export default async function generateStoryImagesJob(job) {
  const { artifactId, pageIds, style = "children's book illustration" } = job.data;

  try {
    console.log(`[Generate Story Images] Processing job for artifact ${artifactId}`);

    // Get the pages that need images
    const pages = await ArtifactPage.query()
      .where('artifact_id', artifactId)
      .whereIn('id', pageIds || [])
      .orderBy('page_number', 'asc');

    if (pages.length === 0) {
      throw new Error(`No pages found for artifact ${artifactId}`);
    }

    const results = [];

    // Generate image prompts for each page
    for (const page of pages) {
      try {
        // Generate an enhanced image prompt using AI
        const imagePrompt = await aiService.generateImagePrompt(page.text, style);
        
        // Update the page with the generated image prompt
        await page.$query().patch({
          image_prompt: imagePrompt,
          metadata: {
            ...page.metadata,
            image_prompt_generated_at: new Date().toISOString(),
          },
        });

        results.push({
          pageId: page.id,
          pageNumber: page.page_number,
          imagePrompt,
          success: true,
        });

        console.log(`[Generate Story Images] Generated image prompt for page ${page.page_number}`);
      } catch (pageError) {
        console.error(`[Generate Story Images] Error processing page ${page.id}:`, pageError);
        results.push({
          pageId: page.id,
          pageNumber: page.page_number,
          error: pageError.message,
          success: false,
        });
      }
    }

    console.log(`[Generate Story Images] Completed processing ${results.length} pages for artifact ${artifactId}`);
    return { success: true, results };

  } catch (error) {
    console.error(`[Generate Story Images] Error processing job for artifact ${artifactId}:`, error);
    throw error;
  }
}