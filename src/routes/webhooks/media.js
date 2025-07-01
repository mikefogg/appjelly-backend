import express from "express";
import crypto from "crypto";
import { Media, Actor, ArtifactPage } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import { mediaQueue, safetyQueue, notificationQueue, analyticsQueue, MEDIA_JOBS, SAFETY_JOBS } from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

// Media processing webhook endpoint (from Cloudflare Images, AWS S3, etc.)
router.post("/", async (req, res) => {
  try {
    const webhookData = req.body;
    
    // Verify webhook signature if configured
    const signature = req.headers['x-media-signature'] || req.headers['x-cloudflare-signature'];
    if (process.env.MEDIA_WEBHOOK_SECRET && signature) {
      const isValidSignature = verifyMediaSignature(req.body, signature, process.env.MEDIA_WEBHOOK_SECRET);
      if (!isValidSignature) {
        return res.status(401).json(formatError("Invalid webhook signature"));
      }
    }

    // Log the webhook for debugging (only in development)
    if (process.env.NODE_ENV === "development") {
      console.log("Media webhook received:", {
        event_type: webhookData.event_type,
        image_key: webhookData.image_key,
        status: webhookData.status,
        timestamp: new Date().toISOString(),
      });
    }

    // Process the media webhook
    await processMediaEvent(webhookData);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Media webhook error:", error);
    return res.status(500).json(formatError("Failed to process media webhook"));
  }
});

const verifyMediaSignature = (payload, signature, secret) => {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(`sha256=${expectedSignature}`)
    );
  } catch (error) {
    console.error("Error verifying media webhook signature:", error);
    return false;
  }
};

const processMediaEvent = async (webhookData) => {
  const { event_type, image_key, status, metadata } = webhookData;

  switch (event_type) {
    case "image.uploaded":
      await handleImageUploaded(image_key, metadata);
      break;
    
    case "image.processed":
      await handleImageProcessed(image_key, status, metadata);
      break;
    
    case "image.optimized":
      await handleImageOptimized(image_key, metadata);
      break;
    
    case "image.failed":
      await handleImageFailed(image_key, metadata);
      break;
    
    case "batch.completed":
      await handleBatchCompleted(metadata);
      break;
    
    default:
      if (process.env.NODE_ENV === "development") {
        console.log(`Unhandled media webhook event: ${event_type}`);
      }
  }
};

const handleImageUploaded = async (imageKey, metadata) => {

  try {
    // Find the media record
    const media = await Media.query().findOne({ image_key: imageKey });
    
    if (!media) {
      return;
    }

    // Update media status
    await media.$query().patch({
      metadata: {
        ...media.metadata,
        upload_status: "uploaded",
        uploaded_at: new Date().toISOString(),
        file_size: metadata?.file_size,
        dimensions: metadata?.dimensions,
        format: metadata?.format,
      },
    });

    // Queue image processing jobs
    await mediaQueue.add(MEDIA_JOBS.PROCESS_IMAGE_UPLOAD, {
      mediaId: media.id,
      imageKey,
      metadata,
    });

    // Queue content safety scan for user-uploaded images
    if (media.owner_type === "actor") {
      await safetyQueue.add(SAFETY_JOBS.MODERATE_CONTENT, {
        content_type: "image",
        content_id: media.id,
        image_key: imageKey,
      });
    }

  } catch (error) {
    console.error("Error handling image.uploaded:", error);
    throw error;
  }
};

const handleImageProcessed = async (imageKey, status, metadata) => {

  try {
    const media = await Media.query().findOne({ image_key: imageKey });
    
    if (!media) {
      return;
    }

    const updateData = {
      metadata: {
        ...media.metadata,
        processing_status: status,
        processed_at: new Date().toISOString(),
      },
    };

    if (status === "completed") {
      updateData.metadata = {
        ...updateData.metadata,
        variants: metadata?.variants || [],
        cdn_urls: metadata?.cdn_urls || {},
        optimization_stats: metadata?.optimization_stats,
      };

      // If this is an actor image that was successfully processed, 
      // notify the owner that their character image is ready
      if (media.owner_type === "actor") {
        const actor = await Actor.query()
          .findById(media.owner_id)
          .withGraphFetched("account");

        if (actor?.account) {
          // Queue notification job
          await notificationQueue.add("character-image-ready", {
            accountId: actor.account.id,
            actorId: actor.id,
            imageKey,
          });
        }
      }
    } else if (status === "failed") {
      updateData.metadata = {
        ...updateData.metadata,
        error: metadata?.error,
        retry_count: (media.metadata?.retry_count || 0) + 1,
      };

      // Queue retry if we haven't exceeded max attempts
      if (updateData.metadata.retry_count < 3) {
        await mediaQueue.add(
          MEDIA_JOBS.PROCESS_IMAGE_UPLOAD,
          {
            mediaId: media.id,
            imageKey,
            metadata,
            isRetry: true,
          },
          {
            delay: 30000, // Retry after 30 seconds
          }
        );
      }
    }

    await media.$query().patch(updateData);

  } catch (error) {
    console.error("Error handling image.processed:", error);
    throw error;
  }
};

const handleImageOptimized = async (imageKey, metadata) => {

  try {
    const media = await Media.query().findOne({ image_key: imageKey });
    
    if (!media) {
      return;
    }

    await media.$query().patch({
      metadata: {
        ...media.metadata,
        optimization_status: "completed",
        optimized_at: new Date().toISOString(),
        optimization_savings: metadata?.optimization_savings,
        final_file_size: metadata?.final_file_size,
        quality_score: metadata?.quality_score,
      },
    });

  } catch (error) {
    console.error("Error handling image.optimized:", error);
    throw error;
  }
};

const handleImageFailed = async (imageKey, metadata) => {

  try {
    const media = await Media.query().findOne({ image_key: imageKey });
    
    if (!media) {
      return;
    }

    await media.$query().patch({
      metadata: {
        ...media.metadata,
        processing_status: "failed",
        failed_at: new Date().toISOString(),
        error_code: metadata?.error_code,
        error_message: metadata?.error_message,
        retry_count: (media.metadata?.retry_count || 0) + 1,
      },
    });

    // If this was a user's character image and it failed, 
    // notify them and suggest alternatives
    if (media.owner_type === "actor") {
      const actor = await Actor.query()
        .findById(media.owner_id)
        .withGraphFetched("account");

      if (actor?.account) {
        await notificationQueue.add("image-processing-failed", {
          accountId: actor.account.id,
          actorId: actor.id,
          imageKey,
          errorMessage: metadata?.error_message,
        });
      }
    }

  } catch (error) {
    console.error("Error handling image.failed:", error);
    throw error;
  }
};

const handleBatchCompleted = async (metadata) => {

  try {
    const { batch_id, completed_count, failed_count, total_count } = metadata;

    // Batch completion handled

    // If this was a story illustration batch, notify the user
    if (metadata?.batch_type === "story_illustrations") {
      const accountId = metadata?.account_id;
      const artifactId = metadata?.artifact_id;

      if (accountId && artifactId) {
        await notificationQueue.add("story-images-ready", {
          accountId,
          artifactId,
          completedCount: completed_count,
          totalCount: total_count,
        });
      }
    }

    // Track batch processing analytics
    await analyticsQueue.add("track-batch-completion", {
      batch_id,
      batch_type: metadata?.batch_type,
      completed_count,
      failed_count,
      total_count,
      processing_duration: metadata?.processing_duration,
    });
  } catch (error) {
    console.error("Error handling batch.completed:", error);
    throw error;
  }
};

export default router;