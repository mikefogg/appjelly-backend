/**
 * Twitter OAuth Service
 * Handles OAuth 2.0 authorization flow for Twitter/X
 */

import { BaseOAuthService } from "./BaseOAuthService.js";

class TwitterOAuthService extends BaseOAuthService {
  constructor() {
    super({
      platform: "twitter",
      clientId: process.env.TWITTER_CLIENT_ID,
      clientSecret: process.env.TWITTER_CLIENT_SECRET,
      callbackUrl: process.env.TWITTER_CALLBACK_URL,
      authorizationUrl: "https://twitter.com/i/oauth2/authorize",
      tokenUrl: "https://api.twitter.com/2/oauth2/token",
      scopes: [
        "tweet.read",
        "users.read",
        "follows.read",
        "list.read", // Required for accessing lists
        "offline.access", // Required for refresh token
      ],
    });

    // Only validate config if env vars are present (allows dev mode without OAuth setup)
    if (process.env.TWITTER_CLIENT_ID) {
      this.validateConfig();
    }
  }

  /**
   * Twitter requires code_challenge for PKCE
   * Using S256 method
   */
  getAdditionalAuthParams() {
    return {
      code_challenge: "challenge",
      code_challenge_method: "plain", // For simplicity, use S256 in production
    };
  }

  /**
   * Get user profile from Twitter API
   * @param {string} accessToken
   * @returns {Object} User profile data
   */
  async getUserProfile(accessToken) {
    const response = await fetch("https://api.twitter.com/2/users/me", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to fetch Twitter profile: ${error.detail || response.statusText}`
      );
    }

    const data = await response.json();
    const user = data.data;

    return {
      platform_user_id: user.id,
      username: user.username,
      display_name: user.name,
      profile_data: user,
    };
  }

  /**
   * Check if token is expired
   * @param {Date} expiresAt
   * @returns {boolean}
   */
  isTokenExpired(expiresAt) {
    if (!expiresAt) return false;
    return new Date() >= new Date(expiresAt);
  }

  /**
   * Calculate token expiration time
   * @param {number} expiresIn - Seconds until expiration
   * @returns {string|null} ISO 8601 date string
   */
  calculateExpiresAt(expiresIn) {
    if (!expiresIn) return null;
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }
}

// Export singleton instance
export default new TwitterOAuthService();
