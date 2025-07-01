import { Media } from "#src/models/index.js";
import { mediaService } from "#src/helpers/index.js";

export const JOB_CLEANUP_EXPIRED_MEDIA = "cleanup-expired-media";

export default async function cleanupExpiredMedia(job) {
  const { batchSize = 50, maxRetries = 3 } = job.data || {};

  console.log("Starting expired media cleanup job");

  try {
    let totalCleaned = 0;
    let hasMore = true;

    while (hasMore) {
      // Find expired pending media in batches
      const expiredMedia = await Media.query()
        .where("status", "pending")
        .where("expires_at", "<=", new Date().toISOString())
        .limit(batchSize)
        .orderBy("expires_at", "asc");

      if (expiredMedia.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`Processing batch of ${expiredMedia.length} expired media records`);

      // Process each media record
      const deletePromises = expiredMedia.map(async (media) => {
        try {
          // Delete from storage service
          await mediaService.deleteImage(media.image_key);
          console.log(`Deleted image ${media.image_key} from storage`);
        } catch (storageError) {
          console.warn(`Failed to delete ${media.image_key} from storage:`, storageError);
          // Continue with database deletion even if storage deletion fails
        }

        try {
          // Delete from database
          await media.$query().delete();
          console.log(`Deleted media record ${media.id} from database`);
          return { success: true, mediaId: media.id };
        } catch (dbError) {
          console.error(`Failed to delete media record ${media.id}:`, dbError);
          return { success: false, mediaId: media.id, error: dbError.message };
        }
      });

      const results = await Promise.allSettled(deletePromises);
      
      // Count successful deletions
      const successful = results.filter(
        result => result.status === 'fulfilled' && result.value.success
      ).length;

      totalCleaned += successful;

      // Log any failures
      const failed = results.filter(
        result => result.status === 'rejected' || 
        (result.status === 'fulfilled' && !result.value.success)
      );

      if (failed.length > 0) {
        console.error(`Failed to clean up ${failed.length} media records in this batch`);
      }

      // Update job progress
      const progress = Math.min(100, Math.round((totalCleaned / (totalCleaned + expiredMedia.length)) * 100));
      job.updateProgress(progress);

      // Short pause between batches to avoid overwhelming the system
      if (expiredMedia.length === batchSize) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Also clean up very old expired records (older than 7 days)
    const veryOldDate = new Date();
    veryOldDate.setDate(veryOldDate.getDate() - 7);

    const veryOldExpired = await Media.query()
      .where("status", "expired")
      .where("created_at", "<=", veryOldDate.toISOString())
      .limit(batchSize);

    if (veryOldExpired.length > 0) {
      console.log(`Cleaning up ${veryOldExpired.length} very old expired media records`);
      
      for (const media of veryOldExpired) {
        try {
          // Try to delete from storage (might already be gone)
          await mediaService.deleteImage(media.image_key);
        } catch (error) {
          console.warn(`Storage deletion failed for old media ${media.image_key}:`, error.message);
        }

        try {
          await media.$query().delete();
          totalCleaned++;
        } catch (error) {
          console.error(`Failed to delete old expired media ${media.id}:`, error);
        }
      }
    }

    console.log(`Expired media cleanup completed. Total cleaned: ${totalCleaned} records`);

    return {
      success: true,
      totalCleaned,
      completedAt: new Date().toISOString(),
    };

  } catch (error) {
    console.error("Expired media cleanup job failed:", error);
    throw error; // Re-throw to trigger job retry if configured
  }
}

// Helper function for manual cleanup (can be called from scripts)
export async function runManualCleanup(options = {}) {
  const fakeJob = {
    data: options,
    updateProgress: (progress) => console.log(`Progress: ${progress}%`),
  };

  return await cleanupExpiredMedia(fakeJob);
}