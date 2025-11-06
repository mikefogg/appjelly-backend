import BaseModel from "#src/models/BaseModel.js";

/**
 * ConnectedAccountAuth - OAuth credentials for connected accounts
 * Separated from ConnectedAccount to allow manual (non-OAuth) accounts
 */
class ConnectedAccountAuth extends BaseModel {
  static get tableName() {
    return "connected_account_auth";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["access_token"],
      properties: {
        ...super.jsonSchema.properties,
        access_token: { type: "string", minLength: 1 },
        refresh_token: { type: ["string", "null"] },
        token_expires_at: { type: ["string", "null"], format: "date-time" },
        metadata: {
          type: "object",
          properties: {
            platform_user_id: { type: "string" },
            username: { type: "string" },
            profile_data: { type: "object" },
          },
        },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: ["string", "null"], format: "date-time" },
      },
    };
  }

  /**
   * Check if token is expired
   */
  isExpired() {
    if (!this.token_expires_at) {
      return false; // No expiry set
    }
    return new Date(this.token_expires_at) < new Date();
  }

  /**
   * Get valid access token (refresh if needed)
   * This method should be implemented per platform
   */
  async getValidAccessToken() {
    if (!this.isExpired()) {
      return this.access_token;
    }

    // If expired, attempt to refresh
    await this.refreshToken();
    return this.access_token;
  }

  /**
   * Refresh OAuth token
   * Override this in platform-specific implementations
   */
  async refreshToken() {
    throw new Error('refreshToken must be implemented by platform-specific auth handler');
  }

  /**
   * Update token data after refresh
   */
  async updateTokens({ access_token, refresh_token, expires_at }) {
    await this.$query().patch({
      access_token,
      refresh_token: refresh_token || this.refresh_token,
      token_expires_at: expires_at,
      updated_at: new Date().toISOString(),
    });

    // Update local instance
    this.access_token = access_token;
    if (refresh_token) this.refresh_token = refresh_token;
    this.token_expires_at = expires_at;
  }
}

export default ConnectedAccountAuth;
