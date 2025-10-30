import express from "express";
import { param } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors } from "#src/middleware/index.js";
import { CuratedTopic, TrendingTopic } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import { successResponse } from "#src/serializers/index.js";

const router = express.Router({ mergeParams: true });

const topicParamValidators = [
  param("topicId").isUUID().withMessage("Invalid topic ID"),
];

// GET /topics - List all available curated topics
router.get(
  "/",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const topics = await CuratedTopic.getActiveTopics();

      const data = topics.map(topic => ({
        id: topic.id,
        slug: topic.slug,
        name: topic.name,
        description: topic.description,
        is_active: topic.is_active,
      }));

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get topics error:", error);
      return res.status(500).json(formatError("Failed to retrieve topics"));
    }
  }
);

// GET /topics/:topicId/trending - Get trending topics for a specific curated topic (for preview/debugging)
router.get(
  "/:topicId/trending",
  requireAppContext,
  requireAuth,
  topicParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const topic = await CuratedTopic.query().findById(req.params.topicId);

      if (!topic) {
        return res.status(404).json(formatError("Topic not found", 404));
      }

      // Get recent trending topics for this curated topic
      const trendingTopics = await TrendingTopic.getRecentForTopic(req.params.topicId, 48);

      const data = {
        curated_topic: {
          id: topic.id,
          slug: topic.slug,
          name: topic.name,
          last_synced_at: topic.last_synced_at,
          last_digested_at: topic.last_digested_at,
        },
        trending_topics: trendingTopics.map(t => ({
          id: t.id,
          topic_name: t.topic_name,
          context: t.context,
          mention_count: t.mention_count,
          total_engagement: parseFloat(t.total_engagement || 0),
          detected_at: t.detected_at,
          expires_at: t.expires_at,
        })),
      };

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get trending topics error:", error);
      return res.status(500).json(formatError("Failed to retrieve trending topics"));
    }
  }
);

export default router;
