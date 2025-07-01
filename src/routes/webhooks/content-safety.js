import express from "express";
import crypto from "crypto";
import { raw } from "objection";
import { Artifact, Media, Input, Account, Actor } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import { notificationQueue, safetyQueue, NOTIFICATION_JOBS, SAFETY_JOBS } from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

// Content safety webhook endpoint (from OpenAI Moderation API, custom AI service, etc.)
router.post("/", async (req, res) => {
  try {
    const webhookData = req.body;
    
    // Verify webhook signature if configured
    const signature = req.headers['x-safety-signature'];
    if (process.env.CONTENT_SAFETY_WEBHOOK_SECRET && signature) {
      const isValidSignature = verifySafetySignature(req.body, signature, process.env.CONTENT_SAFETY_WEBHOOK_SECRET);
      if (!isValidSignature) {
        return res.status(401).json(formatError("Invalid webhook signature"));
      }
    }

    // Log the webhook for debugging (only in development)
    if (process.env.NODE_ENV === "development") {
      console.log("Content safety webhook received:", {
        event_type: webhookData.event_type,
        content_type: webhookData.content_type,
        content_id: webhookData.content_id,
        safety_score: webhookData.safety_score,
        approved: webhookData.approved,
        timestamp: new Date().toISOString(),
      });
    }

    // Process the content safety webhook
    await processContentSafetyEvent(webhookData);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Content safety webhook error:", error);
    return res.status(500).json(formatError("Failed to process content safety webhook"));
  }
});

const verifySafetySignature = (payload, signature, secret) => {
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
    console.error("Error verifying content safety webhook signature:", error);
    return false;
  }
};

const processContentSafetyEvent = async (webhookData) => {
  const { event_type, content_type, content_id, approved, safety_score, categories, reasoning } = webhookData;

  switch (event_type) {
    case "scan.completed":
      await handleScanCompleted(content_type, content_id, approved, safety_score, categories, reasoning);
      break;
    
    case "violation.detected":
      await handleViolationDetected(content_type, content_id, categories, reasoning);
      break;
    
    case "review.required":
      await handleReviewRequired(content_type, content_id, safety_score, reasoning);
      break;
    
    case "content.approved":
      await handleContentApproved(content_type, content_id);
      break;
    
    case "content.rejected":
      await handleContentRejected(content_type, content_id, reasoning);
      break;
    
    default:
      if (process.env.NODE_ENV === "development") {
        console.log(`Unhandled content safety webhook event: ${event_type}`);
      }
  }
};

const handleScanCompleted = async (contentType, contentId, approved, safetyScore, categories, reasoning) => {
  try {
    const moderationResult = {
      safety_score: safetyScore,
      approved,
      categories: categories || {},
      reasoning: reasoning || "",
      scanned_at: new Date().toISOString(),
    };

    // Update the content with moderation results
    await updateContentModerationStatus(contentType, contentId, moderationResult);

    // If content was flagged, queue for human review
    if (!approved && safetyScore > 7) {
      await safetyQueue.add(SAFETY_JOBS.PROCESS_CONTENT_REPORT, {
        content_type: contentType,
        content_id: contentId,
        reason: "ai_flagged_high_risk",
        moderation_result: moderationResult,
        priority: "high",
      });

      // Immediately hide the content if it's severe
      await hideContentTemporarily(contentType, contentId);
    } else if (!approved && safetyScore > 5) {
      // Queue for lower priority review
      await safetyQueue.add(SAFETY_JOBS.PROCESS_CONTENT_REPORT, {
        content_type: contentType,
        content_id: contentId,
        reason: "ai_flagged_medium_risk",
        moderation_result: moderationResult,
        priority: "medium",
      });
    }

  } catch (error) {
    console.error("Error handling scan.completed:", error);
    throw error;
  }
};

const handleViolationDetected = async (contentType, contentId, categories, reasoning) => {
  try {
    // Immediately hide the content
    await hideContentTemporarily(contentType, contentId);

    // Queue for urgent human review
    await safetyQueue.add(SAFETY_JOBS.PROCESS_CONTENT_REPORT, {
      content_type: contentType,
      content_id: contentId,
      reason: "violation_detected",
      categories,
      reasoning,
      priority: "urgent",
    });

    // Notify the content owner
    const account = await getContentOwner(contentType, contentId);
    if (account) {
      await notificationQueue.add(NOTIFICATION_JOBS.SEND_PUSH_NOTIFICATION, {
        accountId: account.id,
        title: "Content Under Review",
        body: "One of your items is being reviewed for safety compliance.",
        data: {
          type: "content_violation",
          content_type: contentType,
          content_id: contentId,
        },
      });
    }

  } catch (error) {
    console.error("Error handling violation.detected:", error);
    throw error;
  }
};

const handleReviewRequired = async (contentType, contentId, safetyScore, reasoning) => {
  try {
    // Queue for human review
    await safetyQueue.add(SAFETY_JOBS.PROCESS_CONTENT_REPORT, {
      content_type: contentType,
      content_id: contentId,
      reason: "review_required",
      safety_score: safetyScore,
      reasoning,
      priority: "normal",
    });

    // Mark content as pending review
    await updateContentModerationStatus(contentType, contentId, {
      review_status: "pending",
      review_requested_at: new Date().toISOString(),
      safety_score: safetyScore,
      reasoning,
    });

  } catch (error) {
    console.error("Error handling review.required:", error);
    throw error;
  }
};

const handleContentApproved = async (contentType, contentId) => {
  try {
    // Update content status to approved
    await updateContentModerationStatus(contentType, contentId, {
      review_status: "approved",
      approved_at: new Date().toISOString(),
      visibility_status: "visible",
    });

    // Restore content visibility if it was hidden
    await restoreContentVisibility(contentType, contentId);

    // Notify the content owner
    const account = await getContentOwner(contentType, contentId);
    if (account) {
      await notificationQueue.add(NOTIFICATION_JOBS.SEND_PUSH_NOTIFICATION, {
        accountId: account.id,
        title: "Content Approved",
        body: "Your content has been reviewed and approved!",
        data: {
          type: "content_approved",
          content_type: contentType,
          content_id: contentId,
        },
      });
    }

  } catch (error) {
    console.error("Error handling content.approved:", error);
    throw error;
  }
};

const handleContentRejected = async (contentType, contentId, reasoning) => {
  try {
    // Update content status to rejected
    await updateContentModerationStatus(contentType, contentId, {
      review_status: "rejected",
      rejected_at: new Date().toISOString(),
      rejection_reason: reasoning,
      visibility_status: "hidden",
    });

    // Permanently hide the content
    await hideContentPermanently(contentType, contentId);

    // Notify the content owner with guidance
    const account = await getContentOwner(contentType, contentId);
    if (account) {
      await notificationQueue.add(NOTIFICATION_JOBS.SEND_PUSH_NOTIFICATION, {
        accountId: account.id,
        title: "Content Review Complete",
        body: "Your content doesn't meet our safety guidelines. Please review our content policy.",
        data: {
          type: "content_rejected",
          content_type: contentType,
          content_id: contentId,
          reasoning,
        },
      });
    }

  } catch (error) {
    console.error("Error handling content.rejected:", error);
    throw error;
  }
};

// Helper functions
const updateContentModerationStatus = async (contentType, contentId, moderationData) => {
  const updateData = {
    metadata: raw(`metadata || '${JSON.stringify({ content_safety: moderationData })}'`),
  };

  switch (contentType) {
    case "artifact":
      await Artifact.query().findById(contentId).patch(updateData);
      break;
    case "input":
      await Input.query().findById(contentId).patch(updateData);
      break;
    case "media":
      await Media.query().findById(contentId).patch(updateData);
      break;
    default:
      console.warn(`Unknown content type for moderation update: ${contentType}`);
  }
};

const hideContentTemporarily = async (contentType, contentId) => {
  const hideData = {
    metadata: raw(`metadata || '{"visibility_status": "temporarily_hidden", "hidden_at": "${new Date().toISOString()}"}'`),
  };

  switch (contentType) {
    case "artifact":
      await Artifact.query().findById(contentId).patch(hideData);
      break;
    case "media":
      await Media.query().findById(contentId).patch(hideData);
      break;
  }
};

const hideContentPermanently = async (contentType, contentId) => {
  const hideData = {
    metadata: raw(`metadata || '{"visibility_status": "permanently_hidden", "hidden_at": "${new Date().toISOString()}"}'`),
  };

  switch (contentType) {
    case "artifact":
      await Artifact.query().findById(contentId).patch(hideData);
      break;
    case "media":
      await Media.query().findById(contentId).patch(hideData);
      break;
  }
};

const restoreContentVisibility = async (contentType, contentId) => {
  const restoreData = {
    metadata: raw(`metadata || '{"visibility_status": "visible", "restored_at": "${new Date().toISOString()}"}'`),
  };

  switch (contentType) {
    case "artifact":
      await Artifact.query().findById(contentId).patch(restoreData);
      break;
    case "media":
      await Media.query().findById(contentId).patch(restoreData);
      break;
  }
};

const getContentOwner = async (contentType, contentId) => {
  switch (contentType) {
    case "artifact":
      const artifact = await Artifact.query().findById(contentId).withGraphFetched("account");
      return artifact?.account;
    case "input":
      const input = await Input.query().findById(contentId).withGraphFetched("account");
      return input?.account;
    case "media":
      const media = await Media.query().findById(contentId);
      if (media?.owner_type === "actor") {
        const actor = await Actor.query().findById(media.owner_id).withGraphFetched("account");
        return actor?.account;
      }
      return null;
    default:
      return null;
  }
};

export default router;