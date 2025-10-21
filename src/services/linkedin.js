/**
 * LinkedIn API Service
 * Handles all LinkedIn API interactions
 *
 * IMPORTANT: LinkedIn's API is more restrictive than Twitter's.
 * Reading posts requires "Marketing Developer Platform" or "Community Management" product approval.
 * If you don't have these approvals, getUserPosts() will return an empty array.
 */

class LinkedInService {
  constructor() {
    this.baseUrl = "https://api.linkedin.com/v2";
  }

  /**
   * Make authenticated request to LinkedIn API
   */
  async makeRequest(endpoint, options = {}) {
    const { accessToken, method = "GET", body } = options;

    if (!accessToken) {
      throw new Error("LinkedIn access token is required");
    }

    const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint}`;

    console.log(`[LinkedIn API] ${method} ${url}`);

    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "LinkedIn-Version": "202405",
      "X-Restli-Protocol-Version": "2.0.0",
    };

    const fetchOptions = {
      method,
      headers,
    };

    if (body && method !== "GET") {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      console.error(`[LinkedIn API] Error response for ${method} ${url}:`, error);

      // Handle common LinkedIn API errors
      if (response.status === 403) {
        console.warn(`[LinkedIn API] 403 Forbidden - May need additional product approvals`);
      }

      throw new Error(
        `LinkedIn API error: ${error.message || error.error || "Unknown error"}`
      );
    }

    return response.json();
  }

  /**
   * Get basic user profile from OIDC userinfo endpoint
   */
  async getUserProfile(accessToken) {
    const profile = await this.makeRequest("https://api.linkedin.com/v2/userinfo", {
      accessToken,
    });

    return {
      platform_user_id: profile.sub,
      username: profile.name?.toLowerCase().replace(/\s+/g, "_") || profile.sub,
      display_name: profile.name,
      profile_data: profile,
    };
  }

  /**
   * Get full member profile (more detailed than OIDC userinfo)
   * Note: May require additional permissions
   */
  async getFullProfile(accessToken) {
    return this.makeRequest("/me", { accessToken });
  }

  /**
   * Get user's posts (User Generated Content)
   *
   * IMPORTANT: This requires LinkedIn's "Marketing Developer Platform" product.
   * If your app doesn't have this approval, this will return an empty array.
   *
   * @param {string} accessToken
   * @param {string} authorUrn - LinkedIn URN (e.g., "urn:li:person:ABC123")
   * @param {object} options - Fetch options
   * @returns {Array} User's posts
   */
  async getUserPosts(accessToken, authorUrn, options = {}) {
    const { maxResults = 20 } = options;

    // Ensure authorUrn is in correct format
    const urn = authorUrn.startsWith("urn:") ? authorUrn : `urn:li:person:${authorUrn}`;

    const params = new URLSearchParams({
      q: "author",
      author: urn,
      count: Math.min(maxResults, 50).toString(),
      sortBy: "LAST_MODIFIED",
    });

    try {
      const data = await this.makeRequest(`/ugcPosts?${params.toString()}`, {
        accessToken,
      });

      const posts = data.elements || [];

      return posts.map(post => this.parseLinkedInPost(post));
    } catch (error) {
      // If 403, app doesn't have permission to read posts
      if (error.message.includes("403")) {
        console.warn(
          "[LinkedIn API] Cannot read posts - app needs Marketing Developer Platform approval. " +
          "Returning empty array."
        );
        return [];
      }

      throw error;
    }
  }

  /**
   * Parse raw LinkedIn UGC post into normalized format
   */
  parseLinkedInPost(post) {
    // Extract text content
    const text = post.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary?.text || "";

    // Extract media
    const shareContent = post.specificContent?.["com.linkedin.ugc.ShareContent"];
    const media = shareContent?.media || [];

    // Extract metrics (if available)
    const stats = post.statistics || {};

    // Calculate engagement score
    const likes = stats.numLikes || 0;
    const comments = stats.numComments || 0;
    const shares = stats.numShares || 0;
    const engagementScore = this.calculateEngagement({ likes, comments, shares });

    return {
      post_id: post.id,
      content: text,
      posted_at: new Date(post.created?.time || Date.now()).toISOString(),
      author: post.author,
      media: media.map(m => ({
        type: m.media?.type || "unknown",
        url: m.media?.url || null,
        title: m.title?.text || null,
      })),
      like_count: likes,
      comment_count: comments,
      share_count: shares,
      impression_count: stats.numViews || 0,
      engagement_score: engagementScore,
      raw: post,
    };
  }

  /**
   * Calculate engagement score for a LinkedIn post
   * Similar to Twitter, but weighted differently for LinkedIn
   */
  calculateEngagement(metrics) {
    if (!metrics) return 0;

    const { likes = 0, comments = 0, shares = 0, impressions = 0 } = metrics;

    // LinkedIn weighting:
    // - Comments are most valuable (shows deep engagement)
    // - Shares/reposts are very valuable (content resonated enough to share)
    // - Likes are good but less valuable
    // - Impressions factor in lightly for reach
    return (
      (comments * 5) +
      (shares * 4) +
      (likes * 1.5) +
      (impressions * 0.001)
    );
  }

  /**
   * Extract topics from LinkedIn post text
   * LinkedIn doesn't use hashtags as heavily as Twitter
   */
  extractTopics(text) {
    const topics = [];

    // Extract hashtags (less common on LinkedIn)
    const hashtags = text.match(/#\w+/g) || [];
    topics.push(...hashtags.map(tag => tag.toLowerCase().replace("#", "")));

    return [...new Set(topics)];
  }

  /**
   * Analyze posting patterns for style analysis
   * @param {Array} posts - Array of parsed LinkedIn posts
   * @returns {Object} Style metrics
   */
  analyzePostingStyle(posts) {
    if (!posts || posts.length === 0) {
      return {
        avg_length: 0,
        hashtag_frequency: 0,
        emoji_frequency: 0,
        avg_engagement: 0,
        posting_times: [],
      };
    }

    let totalLength = 0;
    let hashtagCount = 0;
    let emojiCount = 0;
    let totalEngagement = 0;
    const postingTimes = [];

    posts.forEach(post => {
      const text = post.content || "";

      // Length
      totalLength += text.length;

      // Hashtags
      const hashtags = (text.match(/#\w+/g) || []).length;
      hashtagCount += hashtags;

      // Emojis (basic detection)
      const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
      const emojis = (text.match(emojiRegex) || []).length;
      emojiCount += emojis;

      // Engagement
      totalEngagement += post.engagement_score || 0;

      // Posting time
      if (post.posted_at) {
        const date = new Date(post.posted_at);
        postingTimes.push({
          hour: date.getHours(),
          day: date.getDay(), // 0 = Sunday, 6 = Saturday
        });
      }
    });

    return {
      avg_length: Math.round(totalLength / posts.length),
      hashtag_frequency: hashtagCount / posts.length,
      emoji_frequency: emojiCount / posts.length,
      avg_engagement: totalEngagement / posts.length,
      posting_times: postingTimes,
      total_posts: posts.length,
    };
  }

  /**
   * Helper to convert LinkedIn sub (OIDC subject) to URN format
   */
  getAuthorUrn(sub) {
    if (sub.startsWith("urn:")) {
      return sub;
    }
    return `urn:li:person:${sub}`;
  }
}

export default new LinkedInService();
