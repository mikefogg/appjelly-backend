import express from "express";
import { param, body, query } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors } from "#src/middleware/index.js";
import { ConnectedAccount, SamplePost, Rule, CuratedTopic, UserTopicPreference, TrendingTopic } from "#src/models/index.js";
import { formatError } from "#src/helpers/index.js";
import {
  successResponse,
  connectionListSerializer,
  connectionDetailSerializer,
  connectionUpdateSerializer,
  samplePostSerializer,
  ruleSerializer,
  userTopicSerializer,
  connectionTrendingSerializer,
  connectionTrendingResponseSerializer,
  rotationSettingsSerializer,
  messageResponse,
} from "#src/serializers/index.js";
import { ghostQueue, JOB_SYNC_NETWORK, JOB_ANALYZE_STYLE } from "#src/background/queues/index.js";

const router = express.Router({ mergeParams: true });

const connectionParamValidators = [
  param("id").isUUID().withMessage("Invalid connection ID"),
];

// GET /connections - List all connected accounts for user
router.get(
  "/",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      // Fetch connections with all counts in optimized queries (no N+1)
      const connections = await ConnectedAccount.findWithCountsForList(
        res.locals.account.id,
        res.locals.app.id
      );

      // Compute sync info from pre-loaded data (no additional queries)
      const data = connections.map(conn => {
        const syncInfo = conn.computeSyncInfo();
        return connectionListSerializer(conn, syncInfo);
      });

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get connections error:", error);
      return res.status(500).json(formatError("Failed to retrieve connections"));
    }
  }
);

// GET /connections/:id - Get specific connection
router.get(
  "/:id",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[writing_style, sample_posts, rules]");

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Get completeness metrics and sync info
      const recommendations = await connection.getCompletionRecommendations();
      const syncInfo = await connection.getSyncInfo();

      const data = connectionDetailSerializer(connection, { recommendations, syncInfo });

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get connection error:", error);
      return res.status(500).json(formatError("Failed to retrieve connection"));
    }
  }
);

// GET /connections/:id/status - Check sync status (lightweight endpoint)
router.get(
  "/:id/status",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("sample_posts");

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      const syncInfo = await connection.getSyncInfo();

      const data = {
        ...syncInfo,
        error: connection.metadata?.last_error || null,
      };

      return res.status(200).json(successResponse(data));
    } catch (error) {
      console.error("Get connection status error:", error);
      return res.status(500).json(formatError("Failed to retrieve connection status"));
    }
  }
);

// PATCH /connections/:id/sync - Trigger manual sync (both jobs)
router.patch(
  "/:id/sync",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Mark as syncing
      await connection.markAsSyncing();

      // Trigger background jobs to sync network and analyze style in parallel
      // Use connection ID as job ID to prevent duplicates
      await Promise.all([
        ghostQueue.add(JOB_SYNC_NETWORK, {
          connectedAccountId: connection.id,
        }, {
          jobId: `sync-network-${connection.id}`,
        }),
        ghostQueue.add(JOB_ANALYZE_STYLE, {
          connectedAccountId: connection.id,
        }, {
          jobId: `analyze-style-${connection.id}`,
        }),
      ]);

      return res.status(200).json(successResponse({
        message: "Sync initiated",
        sync_status: "syncing",
      }));
    } catch (error) {
      console.error("Sync connection error:", error);
      return res.status(500).json(formatError("Failed to sync connection"));
    }
  }
);

// PATCH /connections/:id/sync-network - Trigger network sync only
router.patch(
  "/:id/sync-network",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Trigger sync-network job (use connection ID as job ID to prevent duplicates)
      const job = await ghostQueue.add(JOB_SYNC_NETWORK, {
        connectedAccountId: connection.id,
      }, {
        jobId: `sync-network-${connection.id}`,
      });

      return res.status(200).json(successResponse({
        message: "Network sync initiated",
        job_id: job.id,
      }));
    } catch (error) {
      console.error("Sync network error:", error);
      return res.status(500).json(formatError("Failed to sync network"));
    }
  }
);

// PATCH /connections/:id/analyze-style - Trigger style analysis only
router.patch(
  "/:id/analyze-style",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Trigger analyze-style job (use connection ID as job ID to prevent duplicates)
      const job = await ghostQueue.add(JOB_ANALYZE_STYLE, {
        connectedAccountId: connection.id,
      }, {
        jobId: `analyze-style-${connection.id}`,
      });

      return res.status(200).json(successResponse({
        message: "Style analysis initiated",
        job_id: job.id,
      }));
    } catch (error) {
      console.error("Analyze style error:", error);
      return res.status(500).json(formatError("Failed to analyze style"));
    }
  }
);

// PATCH /connections/:id - Update connection settings (label, voice, topics)
router.patch(
  "/:id",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    body("label")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage("Label must be between 1 and 100 characters"),
    body("voice")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 2000 })
      .withMessage("Voice must be under 2000 characters"),
    body("topics_of_interest")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 2000 })
      .withMessage("Topics of interest must be under 2000 characters"),
    body("preserve_line_breaks")
      .optional()
      .isBoolean()
      .withMessage("preserve_line_breaks must be a boolean"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { label, voice, topics_of_interest, preserve_line_breaks } = req.body;

      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Update fields
      const updates = {};
      if (label !== undefined) updates.label = label;
      if (voice !== undefined) updates.voice = voice;
      if (topics_of_interest !== undefined) updates.topics_of_interest = topics_of_interest;
      if (preserve_line_breaks !== undefined) updates.preserve_line_breaks = preserve_line_breaks;

      const updated = await connection.$query().patchAndFetch(updates);

      return res.status(200).json(successResponse(connectionUpdateSerializer(updated)));
    } catch (error) {
      console.error("Update connection error:", error);
      return res.status(500).json(formatError("Failed to update connection"));
    }
  }
);

// DELETE /connections/:id - Disconnect account
router.delete(
  "/:id",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Prevent deletion of default ghost account
      if (!connection.is_deletable) {
        return res.status(403).json(formatError("This account cannot be deleted", 403));
      }

      // Soft delete by marking as inactive
      await connection.$query().patch({ is_active: false });

      return res.status(200).json(successResponse(messageResponse("Connection disconnected successfully")));
    } catch (error) {
      console.error("Delete connection error:", error);
      return res.status(500).json(formatError("Failed to disconnect account"));
    }
  }
);

// POST /connections/:id/samples - Create a sample post
router.post(
  "/:id/samples",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    body("content")
      .isString()
      .trim()
      .isLength({ min: 1, max: 5000 })
      .withMessage("Content must be between 1 and 5000 characters"),
    body("notes")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Notes must be under 500 characters"),
    body("sort_order")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Sort order must be a non-negative integer"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { content, notes, sort_order } = req.body;

      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Create sample post
      const samplePost = await SamplePost.query().insert({
        connected_account_id: connection.id,
        content,
        notes: notes || null,
        sort_order: sort_order !== undefined ? sort_order : 0,
      });

      return res.status(201).json(successResponse(samplePostSerializer(samplePost)));
    } catch (error) {
      console.error("Create sample post error:", error);
      return res.status(500).json(formatError("Failed to create sample post"));
    }
  }
);

// GET /connections/:id/samples - List sample posts
router.get(
  "/:id/samples",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Get sample posts ordered by sort_order
      const samplePosts = await SamplePost.query()
        .where("connected_account_id", connection.id)
        .orderBy("sort_order", "asc")
        .orderBy("created_at", "asc");

      return res.status(200).json(successResponse(samplePosts.map(samplePostSerializer)));
    } catch (error) {
      console.error("Get sample posts error:", error);
      return res.status(500).json(formatError("Failed to retrieve sample posts"));
    }
  }
);

// PATCH /connections/:id/samples/:sampleId - Update a sample post
router.patch(
  "/:id/samples/:sampleId",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    param("sampleId").isUUID().withMessage("Invalid sample post ID"),
    body("content")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 5000 })
      .withMessage("Content must be between 1 and 5000 characters"),
    body("notes")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Notes must be under 500 characters"),
    body("sort_order")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Sort order must be a non-negative integer"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { content, notes, sort_order } = req.body;

      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Find and verify sample post belongs to this connection
      const samplePost = await SamplePost.query()
        .findById(req.params.sampleId)
        .where("connected_account_id", connection.id);

      if (!samplePost) {
        return res.status(404).json(formatError("Sample post not found", 404));
      }

      // Build update object
      const updates = {};
      if (content !== undefined) updates.content = content;
      if (notes !== undefined) updates.notes = notes;
      if (sort_order !== undefined) updates.sort_order = sort_order;

      // Update sample post
      const updated = await samplePost.$query().patchAndFetch(updates);

      return res.status(200).json(successResponse(samplePostSerializer(updated)));
    } catch (error) {
      console.error("Update sample post error:", error);
      return res.status(500).json(formatError("Failed to update sample post"));
    }
  }
);

// DELETE /connections/:id/samples/:sampleId - Delete a sample post
router.delete(
  "/:id/samples/:sampleId",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    param("sampleId").isUUID().withMessage("Invalid sample post ID"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Find and verify sample post belongs to this connection
      const samplePost = await SamplePost.query()
        .findById(req.params.sampleId)
        .where("connected_account_id", connection.id);

      if (!samplePost) {
        return res.status(404).json(formatError("Sample post not found", 404));
      }

      // Delete sample post
      await samplePost.$query().delete();

      return res.status(200).json(successResponse(messageResponse("Sample post deleted successfully")));
    } catch (error) {
      console.error("Delete sample post error:", error);
      return res.status(500).json(formatError("Failed to delete sample post"));
    }
  }
);

// GET /connections/:id/rules - List rules with optional filtering
router.get(
  "/:id/rules",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    query("type")
      .optional()
      .isIn(["general", "feedback", "all"])
      .withMessage("Type must be one of: general, feedback, all"),
    query("suggestion_id")
      .optional()
      .isUUID()
      .withMessage("suggestion_id must be a valid UUID"),
    query("active_only")
      .optional()
      .isBoolean()
      .withMessage("active_only must be a boolean"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { type = "all", suggestion_id, active_only = "true" } = req.query;
      const activeOnlyBool = active_only === "true" || active_only === true;

      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      let rules;

      // Filter based on type
      if (type === "general") {
        // Only rules with no feedback_on_suggestion_id
        rules = await Rule.getGeneralRules(connection.id, activeOnlyBool);
      } else if (type === "feedback") {
        // Only rules with feedback_on_suggestion_id
        rules = await Rule.getFeedbackRules(connection.id, suggestion_id || null, activeOnlyBool);
      } else {
        // All rules
        if (suggestion_id) {
          // Filter by specific suggestion
          const query = Rule.query()
            .where("connected_account_id", connection.id)
            .where("feedback_on_suggestion_id", suggestion_id);

          if (activeOnlyBool) {
            query.where("is_active", true);
          }

          rules = await query.orderBy("priority", "desc").orderBy("created_at", "desc");
        } else {
          // Get all rules
          const query = Rule.query()
            .where("connected_account_id", connection.id);

          if (activeOnlyBool) {
            query.where("is_active", true);
          }

          rules = await query.orderBy("priority", "desc").orderBy("created_at", "desc");
        }
      }

      return res.status(200).json(successResponse(rules.map(ruleSerializer)));
    } catch (error) {
      console.error("Get rules error:", error);
      return res.status(500).json(formatError("Failed to retrieve rules"));
    }
  }
);

// POST /connections/:id/rules - Create a rule
router.post(
  "/:id/rules",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    body("rule_type")
      .isString()
      .isIn(["never", "always", "prefer", "tone"])
      .withMessage("Rule type must be one of: never, always, prefer, tone"),
    body("content")
      .isString()
      .trim()
      .isLength({ min: 1, max: 2000 })
      .withMessage("Content must be between 1 and 2000 characters"),
    body("feedback_on_suggestion_id")
      .optional()
      .isUUID()
      .withMessage("feedback_on_suggestion_id must be a valid UUID"),
    body("priority")
      .optional()
      .isInt({ min: 1, max: 10 })
      .withMessage("Priority must be between 1 and 10"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { rule_type, content, feedback_on_suggestion_id, priority } = req.body;

      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Create rule
      const rule = await Rule.query().insert({
        connected_account_id: connection.id,
        rule_type,
        content,
        feedback_on_suggestion_id: feedback_on_suggestion_id || null,
        priority: priority !== undefined ? priority : 5,
        is_active: true,
      });

      return res.status(201).json(successResponse(ruleSerializer(rule)));
    } catch (error) {
      console.error("Create rule error:", error);
      return res.status(500).json(formatError("Failed to create rule"));
    }
  }
);

// PATCH /connections/:id/rules/:ruleId - Update a rule
router.patch(
  "/:id/rules/:ruleId",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    param("ruleId").isUUID().withMessage("Invalid rule ID"),
    body("rule_type")
      .optional()
      .isString()
      .isIn(["never", "always", "prefer", "tone"])
      .withMessage("Rule type must be one of: never, always, prefer, tone"),
    body("content")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 2000 })
      .withMessage("Content must be between 1 and 2000 characters"),
    body("priority")
      .optional()
      .isInt({ min: 1, max: 10 })
      .withMessage("Priority must be between 1 and 10"),
    body("is_active")
      .optional()
      .isBoolean()
      .withMessage("is_active must be a boolean"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { rule_type, content, priority, is_active } = req.body;

      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Find and verify rule belongs to this connection
      const rule = await Rule.query()
        .findById(req.params.ruleId)
        .where("connected_account_id", connection.id);

      if (!rule) {
        return res.status(404).json(formatError("Rule not found", 404));
      }

      // Build update object
      const updates = {};
      if (rule_type !== undefined) updates.rule_type = rule_type;
      if (content !== undefined) updates.content = content;
      if (priority !== undefined) updates.priority = priority;
      if (is_active !== undefined) updates.is_active = is_active;

      // Update rule
      const updated = await rule.$query().patchAndFetch(updates);

      return res.status(200).json(successResponse(ruleSerializer(updated)));
    } catch (error) {
      console.error("Update rule error:", error);
      return res.status(500).json(formatError("Failed to update rule"));
    }
  }
);

// DELETE /connections/:id/rules/:ruleId - Delete a rule
router.delete(
  "/:id/rules/:ruleId",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    param("ruleId").isUUID().withMessage("Invalid rule ID"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Find and verify rule belongs to this connection
      const rule = await Rule.query()
        .findById(req.params.ruleId)
        .where("connected_account_id", connection.id);

      if (!rule) {
        return res.status(404).json(formatError("Rule not found", 404));
      }

      // Delete rule
      await rule.$query().delete();

      return res.status(200).json(successResponse(messageResponse("Rule deleted successfully")));
    } catch (error) {
      console.error("Delete rule error:", error);
      return res.status(500).json(formatError("Failed to delete rule"));
    }
  }
);

// GET /connections/:id/topics - Get user's selected topic preferences
router.get(
  "/:id/topics",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Get user's topic preferences
      const preferences = await UserTopicPreference.getUserTopics(req.params.id);

      return res.status(200).json(successResponse(preferences.map(userTopicSerializer)));
    } catch (error) {
      console.error("Get user topics error:", error);
      return res.status(500).json(formatError("Failed to retrieve user topics"));
    }
  }
);

// PUT /connections/:id/topics - Update user's topic preferences
router.put(
  "/:id/topics",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    body("topic_ids")
      .isArray()
      .withMessage("topic_ids must be an array"),
    body("topic_ids.*")
      .isUUID()
      .withMessage("Each topic_id must be a valid UUID"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { topic_ids } = req.body;

      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Verify all topic IDs exist and are active
      if (topic_ids.length > 0) {
        const topics = await CuratedTopic.query()
          .whereIn("id", topic_ids)
          .where("is_active", true);

        if (topics.length !== topic_ids.length) {
          return res.status(400).json(formatError("One or more invalid topic IDs", 400));
        }
      }

      // Update user's topic preferences
      await UserTopicPreference.setUserTopics(req.params.id, topic_ids);

      // Fetch updated preferences
      const preferences = await UserTopicPreference.getUserTopics(req.params.id);

      return res.status(200).json(successResponse(preferences.map(userTopicSerializer)));
    } catch (error) {
      console.error("Update user topics error:", error);
      return res.status(500).json(formatError("Failed to update user topics"));
    }
  }
);

// GET /connections/:id/trending - Get personalized trending topics with rotation context
router.get(
  "/:id/trending",
  requireAppContext,
  requireAuth,
  connectionParamValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Get user's selected topic IDs
      const topicIds = await UserTopicPreference.getUserTopicIds(req.params.id);

      if (topicIds.length === 0) {
        const recommendedContentType = await connection.getNextRecommendedContentType();
        return res.status(200).json(successResponse(
          connectionTrendingResponseSerializer(connection, { recommendedContentType, trendingTopics: [] })
        ));
      }

      // Get mixed trending topics (realtime + evergreen)
      const { realtime, evergreen } = await TrendingTopic.getMixedTrendingForTopics(topicIds, 5, 5);

      // Merge all trending topics
      const trendingTopics = [...realtime, ...evergreen];

      // Get rotation context
      const recommendedContentType = await connection.getNextRecommendedContentType();

      return res.status(200).json(successResponse(
        connectionTrendingResponseSerializer(connection, { recommendedContentType, trendingTopics })
      ));
    } catch (error) {
      console.error("Get trending topics for connection error:", error);
      return res.status(500).json(formatError("Failed to retrieve trending topics"));
    }
  }
);

// PATCH /connections/:id/rotation-settings - Update content rotation settings
router.patch(
  "/:id/rotation-settings",
  requireAppContext,
  requireAuth,
  [
    ...connectionParamValidators,
    body("rotation_enabled")
      .optional()
      .isBoolean()
      .withMessage("rotation_enabled must be a boolean"),
    body("reset_rotation")
      .optional()
      .isBoolean()
      .withMessage("reset_rotation must be a boolean"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { rotation_enabled, reset_rotation } = req.body;

      // Verify connection belongs to user
      const connection = await ConnectedAccount.query()
        .findById(req.params.id)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id);

      if (!connection) {
        return res.status(404).json(formatError("Connection not found", 404));
      }

      // Reset rotation if requested
      if (reset_rotation) {
        await connection.resetRotation();
      }

      // Update rotation enabled setting
      if (typeof rotation_enabled === 'boolean') {
        await connection.$query().patch({
          content_rotation_enabled: rotation_enabled,
        });
      }

      // Fetch updated connection
      const updated = await ConnectedAccount.query().findById(req.params.id);
      const nextRecommended = await updated.getNextRecommendedContentType();

      return res.status(200).json(successResponse(rotationSettingsSerializer(updated, nextRecommended)));
    } catch (error) {
      console.error("Update rotation settings error:", error);
      return res.status(500).json(formatError("Failed to update rotation settings"));
    }
  }
);

export default router;
