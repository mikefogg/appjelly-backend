import express from "express";
import { body, param } from "express-validator";
import {
  requireAuth,
  requireAppContext,
  handleValidationErrors,
  rateLimitByAccount,
} from "#src/middleware/index.js";
import { Artifact, Input, ArtifactPage } from "#src/models/index.js";
import {
  successResponse,
  contentReportSerializer,
  contentGuidelinesSerializer,
  contentModerationSerializer,
  safetyTipsSerializer,
} from "#src/serializers/index.js";
import { formatError, aiService } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

const reportContentValidators = [
  body("content_type")
    .isIn(["artifact", "input", "shared_view"])
    .withMessage("Invalid content type"),
  body("content_id").isUUID().withMessage("Valid content ID is required"),
  body("reason")
    .isIn(["inappropriate", "offensive", "spam", "copyright", "other"])
    .withMessage("Invalid report reason"),
  body("description")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Description must be under 500 characters"),
  body("metadata")
    .optional()
    .isObject()
    .withMessage("Metadata must be an object"),
];

router.post(
  "/report",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(10, 86400000), // 10 reports per day
  reportContentValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        content_type,
        content_id,
        reason,
        description,
        metadata = {},
      } = req.body;

      // Verify the content exists and is accessible
      let content = null;
      if (content_type === "artifact") {
        const accessibleArtifacts = await Artifact.findAccessibleArtifacts(
          res.locals.account.id,
          res.locals.app.id
        );
        content = accessibleArtifacts.find((a) => a.id === content_id);
      } else if (content_type === "input") {
        content = await Input.query()
          .findById(content_id)
          .where("app_id", res.locals.app.id);
      }

      if (!content) {
        return res
          .status(404)
          .json(formatError("Content not found or not accessible", 404));
      }

      // In a real implementation, this would be saved to a content moderation queue
      const report = {
        id: `report_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        reported_by: res.locals.account.id,
        content_type,
        content_id,
        reason,
        description: description || "",
        app_id: res.locals.app.id,
        metadata: {
          ...metadata,
          reported_at: new Date().toISOString(),
          reporter_email: res.locals.account.email,
        },
        status: "pending",
      };

      // Log the report (in production, this would go to a moderation system)

      // Auto-moderate using AI for certain cases
      if (reason === "inappropriate" && content_type === "artifact") {
        try {
          // Get content text for moderation
          const pages = await ArtifactPage.findByArtifact(content_id);
          const contentText = pages.map((p) => p.text).join(" ");

          const moderation = await aiService.moderateContent(contentText);

          if (!moderation.approved) {
            // Flag for immediate review
            report.status = "flagged";
            report.metadata.ai_moderation = moderation;

            // In production, this would trigger immediate content hiding
          }
        } catch (moderationError) {
          console.error("AI moderation failed:", moderationError);
        }
      }

      const data = contentReportSerializer(report);

      return res
        .status(200)
        .json(successResponse(data, "Content report submitted successfully"));
    } catch (error) {
      console.error("Report content error:", error);
      return res
        .status(500)
        .json(formatError("Failed to submit content report"));
    }
  }
);

router.get("/guidelines", requireAppContext, async (req, res) => {
  try {
    const app = res.locals.app;

    // Get app-specific guidelines or use defaults
    const guidelines = app.config?.content_safety?.guidelines || {
      overview:
        "We're committed to creating a safe, positive environment for children and families.",

      allowed_content: [
        "Age-appropriate stories and adventures",
        "Educational and creative content",
        "Positive messages and values",
        "Family-friendly humor and fun",
        "Imaginary and fantasy elements",
      ],

      prohibited_content: [
        "Violence, scary, or disturbing content",
        "Inappropriate language or themes",
        "Content that could frighten children",
        "Personal information or private details",
        "Copyrighted characters without permission",
        "Commercial or promotional content",
      ],

      character_guidelines: [
        "Use real names and descriptions appropriately",
        "Keep character traits positive and age-appropriate",
        "Avoid sharing detailed personal information",
        "Respect privacy when sharing with others",
      ],

      sharing_guidelines: [
        "Only share stories with trusted family and friends",
        "Be mindful of children's privacy in shared content",
        "Report any inappropriate shared content immediately",
        "Use family linking features responsibly",
      ],

      reporting: {
        how_to_report:
          "Use the report button on any content that violates these guidelines",
        what_happens: "Reports are reviewed within 24 hours by our safety team",
        follow_up:
          "We'll take appropriate action and notify you of the outcome",
      },
    };

    const data = contentGuidelinesSerializer(app, guidelines);

    return res
      .status(200)
      .json(
        successResponse(
          data,
          "Content safety guidelines retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Get content guidelines error:", error);
    return res
      .status(500)
      .json(formatError("Failed to retrieve content guidelines"));
  }
});

// Get content safety score for a piece of content (for creators)
router.post(
  "/check",
  requireAppContext,
  requireAuth,

  rateLimitByAccount(20, 3600000), // 20 checks per hour
  body("text")
    .isLength({ min: 1, max: 2000 })
    .withMessage("Text must be 1-2000 characters"),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { text } = req.body;

      // Use AI moderation to check content safety
      const moderation = await aiService.moderateContent(text);

      const data = contentModerationSerializer(moderation);

      return res
        .status(200)
        .json(successResponse(data, "Content safety check completed"));
    } catch (error) {
      console.error("Content safety check error:", error);
      return res
        .status(500)
        .json(formatError("Failed to check content safety"));
    }
  }
);

// Get safety tips for content creation
router.get("/tips", requireAppContext, async (req, res) => {
  try {
    const app = res.locals.app;

    const tips = app.config?.content_safety?.tips || {
      story_prompts: [
        "Focus on positive adventures and learning experiences",
        "Use familiar settings that children find comforting",
        "Include problem-solving and teamwork themes",
        "Avoid scary or violent scenarios",
        "Keep language simple and age-appropriate",
      ],

      character_creation: [
        "Use positive personality traits and interests",
        "Avoid sharing specific personal details in descriptions",
        "Choose appropriate photos that protect privacy",
        "Focus on what makes each character special and unique",
      ],

      sharing_safely: [
        "Only share with people you know and trust",
        "Review stories before sharing with others",
        "Use family linking for close relatives only",
        "Remove or replace personal details when sharing widely",
      ],

      general: [
        "When in doubt, err on the side of caution",
        "Read stories aloud to check how they sound",
        "Consider your child's age and sensitivities",
        "Use the content safety checker for guidance",
      ],
    };

    const data = safetyTipsSerializer(app, tips);

    return res
      .status(200)
      .json(successResponse(data, "Safety tips retrieved successfully"));
  } catch (error) {
    console.error("Get safety tips error:", error);
    return res.status(500).json(formatError("Failed to retrieve safety tips"));
  }
});

export default router;
