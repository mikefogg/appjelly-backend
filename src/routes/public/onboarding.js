import express from "express";
import { param, body } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors } from "#src/middleware/index.js";
import { OnboardingSample } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import { PERSONALITY_QUESTIONS } from "#src/helpers/personality.js";
import { successResponse } from "#src/serializers/index.js";
import { ghostQueue, JOB_GENERATE_ONBOARDING_SAMPLE } from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

// Supported platforms for validation
const SUPPORTED_PLATFORMS = ["twitter", "linkedin", "threads", "facebook", "ghost"];

// Stats dimensions that must be present
const REQUIRED_STATS = ["professionalism", "spacing", "emoji_usage", "directness", "brevity", "humor"];

/**
 * GET /onboarding/personality
 * Get personality questions for the onboarding flow
 */
router.get(
  "/personality",
  requireAppContext,
  async (req, res) => {
    try {
      // Platform param is accepted but currently returns same questions
      // This is future-proofing for platform-specific questions
      const platform = req.query.platform;

      return res.status(200).json(successResponse({
        questions: PERSONALITY_QUESTIONS,
        platform: platform || null,
      }));
    } catch (error) {
      console.error("Get personality error:", error);
      return res.status(500).json(formatError("Failed to retrieve personality questions"));
    }
  }
);

/**
 * POST /onboarding/sample
 * Create a sample post generation request
 */
router.post(
  "/sample",
  requireAppContext,
  requireAuth,
  [
    body("stats")
      .isObject()
      .custom((stats) => {
        // Validate all required dimensions are present
        for (const dim of REQUIRED_STATS) {
          if (typeof stats[dim] !== "number") {
            throw new Error(`Missing or invalid stat: ${dim}`);
          }
        }
        return true;
      })
      .withMessage("Stats must include all dimensions: professionalism, spacing, emoji_usage, directness, brevity, humor"),
    body("platform")
      .isString()
      .isIn(SUPPORTED_PLATFORMS)
      .withMessage(`Platform must be one of: ${SUPPORTED_PLATFORMS.join(", ")}`),
    body("input")
      .isString()
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage("Input must be between 1 and 500 characters"),
    body("previous_sample_id")
      .optional()
      .isUUID()
      .withMessage("previous_sample_id must be a valid UUID"),
    body("feedback_input")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Feedback must be under 500 characters"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { stats, platform, input, previous_sample_id, feedback_input } = req.body;

      // If previous_sample_id provided, verify it exists and belongs to this account
      if (previous_sample_id) {
        const previousSample = await OnboardingSample.query()
          .findById(previous_sample_id)
          .where("app_id", res.locals.app.id)
          .where("account_id", res.locals.account.id);

        if (!previousSample) {
          return res.status(404).json(formatError("Previous sample not found", 404));
        }
      }

      // Create the sample
      const sample = await OnboardingSample.create({
        appId: res.locals.app.id,
        accountId: res.locals.account.id,
        platform,
        stats,
        input,
        previousSampleId: previous_sample_id || null,
        feedbackInput: feedback_input || null,
      });

      // Queue the generation job
      await ghostQueue.add(JOB_GENERATE_ONBOARDING_SAMPLE, {
        sampleId: sample.id,
      });

      return res.status(202).json(successResponse({
        id: sample.id,
        status: sample.status,
        version: sample.version,
        message: "Sample generation queued",
      }));
    } catch (error) {
      console.error("Create sample error:", error);
      return res.status(500).json(formatError("Failed to create sample"));
    }
  }
);

/**
 * GET /onboarding/sample/:id
 * Get sample status and content
 */
router.get(
  "/sample/:id",
  requireAppContext,
  requireAuth,
  [
    param("id").isUUID().withMessage("Invalid sample ID"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const sample = await OnboardingSample.query()
        .findById(req.params.id)
        .where("app_id", res.locals.app.id)
        .where("account_id", res.locals.account.id);

      if (!sample) {
        return res.status(404).json(formatError("Sample not found", 404));
      }

      const response = {
        id: sample.id,
        status: sample.status,
        version: sample.version,
        platform: sample.platform,
        input: sample.input,
        stats: sample.stats,
      };

      // Include content if completed
      if (sample.status === "completed") {
        response.content = sample.content;
        response.character_count = sample.content?.length || 0;
      }

      // Include error if failed
      if (sample.status === "failed") {
        response.error = sample.metadata?.error || "Generation failed";
      }

      // Include feedback chain info
      if (sample.previous_sample_id) {
        response.previous_sample_id = sample.previous_sample_id;
      }
      if (sample.feedback_input) {
        response.feedback_input = sample.feedback_input;
      }

      return res.status(200).json(successResponse(response));
    } catch (error) {
      console.error("Get sample error:", error);
      return res.status(500).json(formatError("Failed to retrieve sample"));
    }
  }
);

export default router;
