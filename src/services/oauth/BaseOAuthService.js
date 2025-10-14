/**
 * Base OAuth Service
 * Provides common OAuth 2.0 functionality for all platforms
 */

export class BaseOAuthService {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.callbackUrl = config.callbackUrl;
    this.platform = config.platform;
    this.authorizationUrl = config.authorizationUrl;
    this.tokenUrl = config.tokenUrl;
    this.scopes = config.scopes || [];
  }

  /**
   * Generate authorization URL for user to approve access
   * @param {string} state - CSRF token
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: "code",
      state,
      scope: this.scopes.join(" "),
    });

    // Add platform-specific params
    const additionalParams = this.getAdditionalAuthParams();
    Object.entries(additionalParams).forEach(([key, value]) => {
      params.append(key, value);
    });

    return `${this.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Platform-specific additional auth parameters
   * Override in subclass if needed
   */
  getAdditionalAuthParams() {
    return {};
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from callback
   * @returns {Object} Token data
   */
  async exchangeCodeForToken(code) {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.callbackUrl,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    // Add platform-specific params
    const additionalParams = this.getAdditionalTokenParams();
    Object.entries(additionalParams).forEach(([key, value]) => {
      params.append(key, value);
    });

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `OAuth token exchange failed: ${error.error_description || error.error || response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Platform-specific additional token parameters
   * Override in subclass if needed
   */
  getAdditionalTokenParams() {
    return {};
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken
   * @returns {Object} New token data
   */
  async refreshAccessToken(refreshToken) {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `OAuth token refresh failed: ${error.error_description || error.error || response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Get user profile data - must be implemented by subclass
   * @param {string} accessToken
   * @returns {Object} User profile data
   */
  async getUserProfile(accessToken) {
    throw new Error("getUserProfile must be implemented by subclass");
  }

  /**
   * Validate platform-specific configuration
   */
  validateConfig() {
    if (!this.clientId) {
      throw new Error(`${this.platform} OAuth: Missing client ID`);
    }
    if (!this.clientSecret) {
      throw new Error(`${this.platform} OAuth: Missing client secret`);
    }
    if (!this.callbackUrl) {
      throw new Error(`${this.platform} OAuth: Missing callback URL`);
    }
  }
}

export default BaseOAuthService;
