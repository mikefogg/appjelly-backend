/**
 * Twitter API Service
 * Handles all Twitter API interactions for Ghost
 */

class TwitterService {
  constructor() {
    this.apiKey = process.env.TWITTER_API_KEY;
    this.apiSecret = process.env.TWITTER_API_SECRET;
    this.baseUrl = "https://api.twitter.com/2";
  }

  /**
   * Make authenticated request to Twitter API
   */
  async makeRequest(endpoint, options = {}) {
    const { accessToken, method = "GET", body } = options;

    if (!accessToken) {
      throw new Error("Twitter access token is required");
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const fetchOptions = {
      method,
      headers,
    };

    if (body && method !== "GET") {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Twitter API error: ${error.error || error.detail || "Unknown error"}`);
    }

    return response.json();
  }

  /**
   * Get authenticated user's profile
   */
  async getMe(accessToken) {
    const data = await this.makeRequest("/users/me", {
      accessToken,
      method: "GET",
    });

    return {
      platform_user_id: data.data.id,
      username: data.data.username,
      display_name: data.data.name,
      profile_data: data.data,
    };
  }

  /**
   * Get user's following list
   * Returns list of users the authenticated user follows
   */
  async getFollowing(accessToken, userId, options = {}) {
    const { maxResults = 1000, paginationToken } = options;

    let allFollowing = [];
    let nextToken = paginationToken;
    let hasMore = true;

    while (hasMore && allFollowing.length < maxResults) {
      const params = new URLSearchParams({
        max_results: Math.min(1000, maxResults - allFollowing.length).toString(),
        "user.fields": "id,name,username,description,profile_image_url,public_metrics,verified",
      });

      if (nextToken) {
        params.append("pagination_token", nextToken);
      }

      const data = await this.makeRequest(
        `/users/${userId}/following?${params.toString()}`,
        { accessToken }
      );

      if (data.data) {
        allFollowing = allFollowing.concat(data.data);
      }

      nextToken = data.meta?.next_token;
      hasMore = !!nextToken && allFollowing.length < maxResults;

      // Rate limiting - pause between requests
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return allFollowing.map(user => ({
      platform_user_id: user.id,
      username: user.username,
      display_name: user.name,
      bio: user.description,
      follower_count: user.public_metrics?.followers_count,
      following_count: user.public_metrics?.following_count,
      is_verified: user.verified || false,
      profile_image_url: user.profile_image_url,
      profile_data: user,
    }));
  }

  /**
   * Get tweets from user's timeline
   * Fetches tweets from users they follow
   */
  async getHomeTimeline(accessToken, userId, options = {}) {
    const { maxResults = 100, sinceId, paginationToken } = options;

    const params = new URLSearchParams({
      max_results: Math.min(100, maxResults).toString(),
      "tweet.fields": "id,text,created_at,public_metrics,author_id,conversation_id",
      "user.fields": "username,name",
      expansions: "author_id",
    });

    if (sinceId) {
      params.append("since_id", sinceId);
    }

    if (paginationToken) {
      params.append("pagination_token", paginationToken);
    }

    const data = await this.makeRequest(
      `/users/${userId}/timelines/reverse_chronological?${params.toString()}`,
      { accessToken }
    );

    const tweets = data.data || [];
    const users = data.includes?.users || [];

    // Map user data for easy lookup
    const userMap = {};
    users.forEach(user => {
      userMap[user.id] = user;
    });

    return {
      tweets: tweets.map(tweet => ({
        post_id: tweet.id,
        author_id: tweet.author_id,
        author_username: userMap[tweet.author_id]?.username,
        content: tweet.text,
        posted_at: tweet.created_at,
        reply_count: tweet.public_metrics?.reply_count || 0,
        retweet_count: tweet.public_metrics?.retweet_count || 0,
        like_count: tweet.public_metrics?.like_count || 0,
        quote_count: tweet.public_metrics?.quote_count || 0,
      })),
      meta: data.meta,
    };
  }

  /**
   * Get user's own tweets
   * For building writing style profile
   */
  async getUserTweets(accessToken, userId, options = {}) {
    const { maxResults = 100, sinceId, paginationToken } = options;

    const params = new URLSearchParams({
      max_results: Math.min(100, maxResults).toString(),
      "tweet.fields": "id,text,created_at,public_metrics",
      exclude: "retweets,replies", // Only get original tweets for style analysis
    });

    if (sinceId) {
      params.append("since_id", sinceId);
    }

    if (paginationToken) {
      params.append("pagination_token", paginationToken);
    }

    const data = await this.makeRequest(
      `/users/${userId}/tweets?${params.toString()}`,
      { accessToken }
    );

    const tweets = data.data || [];

    return {
      tweets: tweets.map(tweet => ({
        post_id: tweet.id,
        content: tweet.text,
        posted_at: tweet.created_at,
        reply_count: tweet.public_metrics?.reply_count || 0,
        retweet_count: tweet.public_metrics?.retweet_count || 0,
        like_count: tweet.public_metrics?.like_count || 0,
        engagement_score: this.calculateEngagement(tweet.public_metrics),
      })),
      meta: data.meta,
    };
  }

  /**
   * Search recent tweets by keyword or hashtag
   */
  async searchTweets(accessToken, query, options = {}) {
    const { maxResults = 100 } = options;

    const params = new URLSearchParams({
      query,
      max_results: Math.min(100, maxResults).toString(),
      "tweet.fields": "id,text,created_at,public_metrics,author_id",
    });

    const data = await this.makeRequest(
      `/tweets/search/recent?${params.toString()}`,
      { accessToken }
    );

    return data.data || [];
  }

  /**
   * Calculate engagement score for a tweet
   */
  calculateEngagement(metrics) {
    if (!metrics) return 0;

    const { reply_count = 0, retweet_count = 0, like_count = 0, quote_count = 0 } = metrics;

    // Weighted engagement score
    // Replies and quotes are more valuable than likes
    return (reply_count * 3) + (quote_count * 2.5) + (retweet_count * 2) + (like_count * 1);
  }

  /**
   * Extract topics from tweet text
   * Simple extraction of hashtags and common keywords
   */
  extractTopics(text) {
    const topics = [];

    // Extract hashtags
    const hashtags = text.match(/#\w+/g) || [];
    topics.push(...hashtags.map(tag => tag.toLowerCase()));

    // Could enhance with more sophisticated topic extraction

    return [...new Set(topics)]; // Remove duplicates
  }

  /**
   * Analyze tweet sentiment (basic implementation)
   */
  analyzeSentiment(text) {
    // Simple sentiment keywords
    const positive = /\b(good|great|awesome|love|excellent|amazing|wonderful|fantastic)\b/i;
    const negative = /\b(bad|terrible|awful|hate|horrible|disappointing|worst)\b/i;

    if (positive.test(text) && !negative.test(text)) return "positive";
    if (negative.test(text) && !positive.test(text)) return "negative";
    return "neutral";
  }
}

export default new TwitterService();
