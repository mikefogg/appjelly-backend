/**
 * Freemium tier configuration
 * All limits and thresholds in one place
 */
const isDevelopment = process.env.NODE_ENV === "development";

const FREE_POSTS_PER_CONNECTION = isDevelopment ? 1000 : 20;
const FREE_CONNECTIONS_LIMIT = isDevelopment ? 5 : 1;
const VOICE_MATCH_THRESHOLD = 40;

export const FREEMIUM_CONFIG = {
  // Voice match threshold required to enable AI features
  VOICE_MATCH_THRESHOLD: VOICE_MATCH_THRESHOLD,

  // Free tier limits (actual values come from API: GET /config -> free_tier_limits)
  FREE_CONNECTIONS_LIMIT: FREE_CONNECTIONS_LIMIT,
  FREE_POSTS_PER_CONNECTION: FREE_POSTS_PER_CONNECTION,

  // Error messages
  ERRORS: {
    VOICE_THRESHOLD_NOT_MET:
      `Voice match score must be at least ${VOICE_MATCH_THRESHOLD}% to use AI features`,
    CONNECTION_LIMIT_REACHED: `Free accounts are limited to ${FREE_CONNECTIONS_LIMIT} connection${
      FREE_CONNECTIONS_LIMIT > 1 ? "s" : ""
    }. Upgrade to create more.`,
    GENERATION_LIMIT_REACHED: `You have used all ${FREE_POSTS_PER_CONNECTION} free generations for this connection. Upgrade to continue.`,
  },
};
