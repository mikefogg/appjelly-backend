/**
 * Config Routes
 * Returns app configuration and metadata
 */

import express from "express";
import { requireAppContext } from "#src/middleware/index.js";
import { successResponse } from "#src/serializers/index.js";
import { PLATFORM_LENGTHS } from "#src/config/platform-lengths.js";
import { FREEMIUM_CONFIG } from "#src/config/freemium.js";

const router = express.Router({ mergeParams: true });

/**
 * GET /config
 * Returns app configuration including platform metadata
 */
router.get(
  "/",
  requireAppContext,
  async (req, res) => {
    // Transform platforms to only include id, label, icon - exclude ghost
    const platforms = Object.entries(PLATFORM_LENGTHS)
      .filter(([key]) => key !== "ghost")
      .map(([key, value]) => ({
        id: key,
        label: value.label,
        icon: value.icon,
      }));

    // Transform platform_lengths to only include length values
    const platformLengths = Object.fromEntries(
      Object.entries(PLATFORM_LENGTHS).map(([key, value]) => [
        key,
        { short: value.short, medium: value.medium, long: value.long },
      ])
    );

    return res.status(200).json(successResponse({
      platforms,
      platform_lengths: platformLengths,
      free_tier_limits: {
        connections: FREEMIUM_CONFIG.FREE_CONNECTIONS_LIMIT,
        posts_per_connection: FREEMIUM_CONFIG.FREE_POSTS_PER_CONNECTION,
      },
      voice_match_threshold: FREEMIUM_CONFIG.VOICE_MATCH_THRESHOLD,
    }));
  }
);

export default router;
