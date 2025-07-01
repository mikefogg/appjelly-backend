import { Input, Artifact, ArtifactPage } from "#src/models/index.js";

export default async function generateStoryJob(job) {
  const { inputId, artifactId } = job.data;

  try {
    console.log(`[Generate Story] Processing job for input ${inputId}`);

    // Get the artifact
    let artifact = await Artifact.query().findById(artifactId);
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    // Update artifact status to generating
    artifact = await artifact.$query().patchAndFetch({
      metadata: {
        ...artifact.metadata,
        status: "generating",
        processing_started_at: new Date().toISOString(),
      },
    });

    // Create simple 10-page story
    const pages = [];
    for (let i = 1; i <= 10; i++) {
      pages.push({
        page_number: i,
        text: `This is page ${i} of the test story. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
        layout_data: {},
      });
    }

    artifact = await Artifact.transaction(async (trx) => {
      // Update artifact with completed status
      const updatedArtifact = await artifact.$query(trx).patchAndFetch({
        title: "Test Story",
        metadata: {
          ...artifact.metadata,
          status: "completed",
          completed_at: new Date().toISOString(),
        },
      });

      // Create pages
      for (const pageData of pages) {
        await ArtifactPage.query(trx).insert({
          artifact_id: artifact.id,
          ...pageData,
        });
      }

      return updatedArtifact;
    });

    console.log(
      `[Generate Story] Successfully generated story for input ${inputId}`
    );
    return { success: true, artifactId: artifact.id };
  } catch (error) {
    console.error(
      `[Generate Story] Error processing job for input ${inputId}:`,
      error
    );

    // Update artifact with error status
    if (artifactId) {
      try {
        await Artifact.query()
          .findById(artifactId)
          .patch({
            metadata: {
              status: "failed",
              error: error.message,
              failed_at: new Date().toISOString(),
            },
          });
      } catch (updateError) {
        console.error(
          `[Generate Story] Failed to update artifact status:`,
          updateError
        );
      }
    }

    throw error;
  }
}
