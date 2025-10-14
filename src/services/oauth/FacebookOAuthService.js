/**
 * Facebook OAuth Service
 * Handles OAuth 2.0 authorization flow for Facebook/Instagram/Threads
 */

import { BaseOAuthService } from "./BaseOAuthService.js";

class FacebookOAuthService extends BaseOAuthService {
  constructor() {
    super({
      platform: "facebook",
      clientId: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackUrl: process.env.FACEBOOK_CALLBACK_URL,
      authorizationUrl: "https://www.facebook.com/v18.0/dialog/oauth",
      tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
      scopes: [
        "public_profile",
        "email",
        "pages_show_list",
        "pages_read_engagement",
        "instagram_basic",
        "instagram_content_publish",
        "publish_to_groups", // For Threads
      ],
    });

    this.validateConfig();
    this.graphApiUrl = "https://graph.facebook.com/v18.0";
  }

  /**
   * Get user profile from Facebook Graph API
   * @param {string} accessToken
   * @returns {Object} User profile data
   */
  async getUserProfile(accessToken) {
    const params = new URLSearchParams({
      fields: "id,name,email,picture",
      access_token: accessToken,
    });

    const response = await fetch(`${this.graphApiUrl}/me?${params.toString()}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to fetch Facebook profile: ${error.error?.message || response.statusText}`
      );
    }

    const user = await response.json();

    return {
      platform_user_id: user.id,
      username: user.name, // Facebook doesn't have @usernames like Twitter
      display_name: user.name,
      profile_data: {
        ...user,
        email: user.email,
        picture_url: user.picture?.data?.url,
      },
    };
  }

  /**
   * Exchange short-lived token for long-lived token
   * Facebook tokens expire after 1 hour by default
   * Long-lived tokens last 60 days
   * @param {string} shortLivedToken
   * @returns {Object} Long-lived token data
   */
  async exchangeForLongLivedToken(shortLivedToken) {
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      fb_exchange_token: shortLivedToken,
    });

    const response = await fetch(
      `${this.graphApiUrl}/oauth/access_token?${params.toString()}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to exchange for long-lived token: ${error.error?.message || response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Get user's Instagram account (if connected)
   * @param {string} accessToken
   * @param {string} userId - Facebook user ID
   * @returns {Object|null} Instagram account data
   */
  async getInstagramAccount(accessToken, userId) {
    try {
      const params = new URLSearchParams({
        fields: "instagram_business_account",
        access_token: accessToken,
      });

      const response = await fetch(
        `${this.graphApiUrl}/${userId}?${params.toString()}`
      );

      if (!response.ok) return null;

      const data = await response.json();
      return data.instagram_business_account || null;
    } catch (error) {
      console.error("Failed to fetch Instagram account:", error);
      return null;
    }
  }

  /**
   * Check if token is expired
   * @param {Date} expiresAt
   * @returns {boolean}
   */
  isTokenExpired(expiresAt) {
    if (!expiresAt) return false;
    // Refresh 7 days before expiration for long-lived tokens
    const bufferTime = 7 * 24 * 60 * 60 * 1000;
    return new Date().getTime() + bufferTime >= new Date(expiresAt).getTime();
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
export default new FacebookOAuthService();
