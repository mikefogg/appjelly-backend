/**
 * LinkedIn OAuth Service
 * Handles OAuth 2.0 authorization flow for LinkedIn
 */

import { BaseOAuthService } from "./BaseOAuthService.js";

class LinkedInOAuthService extends BaseOAuthService {
  constructor() {
    super({
      platform: "linkedin",
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      callbackUrl: process.env.LINKEDIN_CALLBACK_URL,
      authorizationUrl: "https://www.linkedin.com/oauth/v2/authorization",
      tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
      scopes: [
        "openid",
        "profile",
        "email",
        // "w_member_social", // Post on behalf of user
      ],
    });

    // Only validate config if env vars are present (allows dev mode without OAuth setup)
    if (process.env.LINKEDIN_CLIENT_ID) {
      this.validateConfig();
    }
    this.apiUrl = "https://api.linkedin.com/v2";
  }

  /**
   * Get user profile from LinkedIn API using OIDC
   * @param {string} accessToken
   * @returns {Object} User profile data
   */
  async getUserProfile(accessToken) {
    // Fetch profile using OIDC userinfo endpoint
    const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    });

    if (!profileResponse.ok) {
      const error = await profileResponse.json().catch(() => ({}));
      throw new Error(
        `Failed to fetch LinkedIn profile: ${error.message || profileResponse.statusText}`
      );
    }

    const profile = await profileResponse.json();

    // OIDC userinfo response structure:
    // {
    //   "sub": "user-id",
    //   "name": "Full Name",
    //   "given_name": "First",
    //   "family_name": "Last",
    //   "picture": "https://...",
    //   "email": "user@example.com",
    //   "email_verified": true
    // }

    const displayName = profile.name || `${profile.given_name || ""} ${profile.family_name || ""}`.trim();
    const username = displayName.toLowerCase().replace(/\s+/g, "_") || profile.sub;

    return {
      platform_user_id: profile.sub,
      username,
      display_name: displayName,
      profile_data: {
        ...profile,
        firstName: profile.given_name,
        lastName: profile.family_name,
      },
    };
  }

  /**
   * Check if token is expired
   * LinkedIn tokens expire after 60 days
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

  /**
   * Note: LinkedIn does not provide refresh tokens in OAuth 2.0
   * Tokens must be re-authorized when expired
   */
  async refreshAccessToken(refreshToken) {
    throw new Error(
      "LinkedIn does not support refresh tokens. User must re-authorize."
    );
  }

  /**
   * Get full member profile (requires additional permissions)
   * @param {string} accessToken
   * @returns {Object} Full profile data
   */
  async getFullProfile(accessToken) {
    const response = await fetch(`${this.apiUrl}/me`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "LinkedIn-Version": "202405",
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to fetch LinkedIn full profile: ${error.message || response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Get user's posts (UGC - User Generated Content)
   * Note: This requires special LinkedIn API access and may not be available for all apps
   *
   * @param {string} accessToken
   * @param {string} authorUrn - Author URN (e.g., "urn:li:person:ABC123")
   * @param {number} count - Number of posts to fetch (default 20, max 50)
   * @returns {Array} User's posts
   */
  async getUserPosts(accessToken, authorUrn, count = 20) {
    // LinkedIn's UGC Posts API
    // Requires: Marketing Developer Platform access or Community Management product
    const params = new URLSearchParams({
      q: "author",
      author: authorUrn,
      count: Math.min(count, 50).toString(),
    });

    const response = await fetch(`${this.apiUrl}/ugcPosts?${params.toString()}`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "LinkedIn-Version": "202405",
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      // If 403, likely means the app doesn't have permission
      if (response.status === 403) {
        console.warn("LinkedIn API: Insufficient permissions to read posts. App may need Marketing Developer Platform access.");
        return []; // Return empty array instead of throwing
      }

      throw new Error(
        `Failed to fetch LinkedIn posts: ${error.message || response.statusText}`
      );
    }

    const data = await response.json();
    return data.elements || [];
  }

  /**
   * Parse LinkedIn posts into a consistent format
   * @param {Array} posts - Raw LinkedIn UGC posts
   * @returns {Array} Normalized posts
   */
  parseLinkedInPosts(posts) {
    return posts.map(post => {
      // Extract text content
      const text = post.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary?.text || "";

      // Extract media
      const media = post.specificContent?.["com.linkedin.ugc.ShareContent"]?.media || [];

      // Extract metrics
      const stats = post.statistics || {};

      return {
        id: post.id,
        content: text,
        created_at: new Date(post.created?.time || Date.now()).toISOString(),
        author: post.author,
        media: media.map(m => ({
          type: m.media?.type || "unknown",
          url: m.media?.url || null,
        })),
        metrics: {
          likes: stats.numLikes || 0,
          comments: stats.numComments || 0,
          shares: stats.numShares || 0,
          impressions: stats.numViews || 0,
        },
        raw: post, // Keep raw data for reference
      };
    });
  }

  /**
   * Helper to convert profile sub to URN format
   * @param {string} sub - OIDC subject ID
   * @returns {string} LinkedIn URN
   */
  getAuthorUrn(sub) {
    // If sub is already a URN, return it
    if (sub.startsWith("urn:")) {
      return sub;
    }

    // Otherwise, convert to person URN
    return `urn:li:person:${sub}`;
  }
}

// Export singleton instance
export default new LinkedInOAuthService();
