/**
 * Freemium tier configuration
 * All limits and thresholds in one place
 */
const isDevelopment = process.env.NODE_ENV === 'development';

export const FREEMIUM_CONFIG = {
  // Voice match threshold required to enable AI features
  VOICE_MATCH_THRESHOLD: 50,

  // Free tier limits
  FREE_CONNECTIONS_LIMIT: isDevelopment ? 5 : 1,
  FREE_POSTS_PER_CONNECTION: isDevelopment ? 1000 : 40,

  // Error messages
  ERRORS: {
    VOICE_THRESHOLD_NOT_MET: 'Voice match score must be at least 50% to use AI features',
    CONNECTION_LIMIT_REACHED: `Free accounts are limited to ${isDevelopment ? 5 : 1} connection${isDevelopment ? 's' : ''}. Upgrade to create more.`,
    GENERATION_LIMIT_REACHED: 'You have used all 20 free generations for this connection. Upgrade to continue.',
  }
};
