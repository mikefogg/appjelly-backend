/**
 * Config Routes
 * Returns app configuration and metadata
 */

import express from "express";
import { requireAppContext } from "#src/middleware/index.js";
import { successResponse } from "#src/serializers/index.js";
import { PLATFORM_LENGTHS } from "#src/config/platform-lengths.js";

const router = express.Router({ mergeParams: true });

/**
 * GET /config
 * Returns app configuration including platform metadata
 */
router.get(
  "/",
  requireAppContext,
  async (req, res) => {
    return res.status(200).json(successResponse({
      platform_lengths: PLATFORM_LENGTHS,
    }));
  }
);

export default router;
