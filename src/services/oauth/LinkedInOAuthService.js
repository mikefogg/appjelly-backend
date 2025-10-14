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
        "r_liteprofile",
        "r_emailaddress",
        "w_member_social", // Post on behalf of user
      ],
    });

    this.validateConfig();
    this.apiUrl = "https://api.linkedin.com/v2";
  }

  /**
   * Get user profile from LinkedIn API
   * @param {string} accessToken
   * @returns {Object} User profile data
   */
  async getUserProfile(accessToken) {
    // Fetch profile
    const profileResponse = await fetch(`${this.apiUrl}/me`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Connection": "Keep-Alive",
      },
    });

    if (!profileResponse.ok) {
      const error = await profileResponse.json().catch(() => ({}));
      throw new Error(
        `Failed to fetch LinkedIn profile: ${error.message || profileResponse.statusText}`
      );
    }

    const profile = await profileResponse.json();

    // Fetch email separately (LinkedIn requires separate endpoint)
    let email = null;
    try {
      const emailResponse = await fetch(
        `${this.apiUrl}/emailAddress?q=members&projection=(elements*(handle~))`,
        {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Connection": "Keep-Alive",
          },
        }
      );

      if (emailResponse.ok) {
        const emailData = await emailResponse.json();
        email = emailData.elements?.[0]?.["handle~"]?.emailAddress;
      }
    } catch (error) {
      console.warn("Failed to fetch LinkedIn email:", error);
    }

    // Extract name from localized data
    const firstName = profile.localizedFirstName || "";
    const lastName = profile.localizedLastName || "";
    const displayName = `${firstName} ${lastName}`.trim();

    return {
      platform_user_id: profile.id,
      username: displayName.toLowerCase().replace(/\s+/g, "_"),
      display_name: displayName,
      profile_data: {
        ...profile,
        email,
        firstName,
        lastName,
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
}

// Export singleton instance
export default new LinkedInOAuthService();
