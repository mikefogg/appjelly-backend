/**
 * Rate Limiter Service
 * Implements sliding window rate limiting using Redis sorted sets
 * Tracks per-endpoint, per-user rate limits for Twitter API
 */

import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Twitter API v2 rate limits (per user)
// https://developer.twitter.com/en/docs/twitter-api/rate-limits
const RATE_LIMITS = {
  timeline: { requests: 5, windowMinutes: 15 },
  user_tweets: { requests: 100, windowMinutes: 15 },
  following: { requests: 15, windowMinutes: 15 },
  user_me: { requests: 75, windowMinutes: 15 },
  search: { requests: 180, windowMinutes: 15 },
};

class RateLimiter {
  constructor() {
    this.redis = redis;
  }

  /**
   * Get the Redis key for an endpoint and user
   */
  getKey(endpoint, userId) {
    return `twitter_rate_limit:${endpoint}:${userId}`;
  }

  /**
   * Check if request can proceed within rate limit
   * Returns { allowed: boolean, retryAfter: number|null }
   */
  async checkRateLimit(endpoint, userId) {
    const limit = RATE_LIMITS[endpoint];
    if (!limit) {
      // No rate limit configured for this endpoint
      return { allowed: true, retryAfter: null };
    }

    const key = this.getKey(endpoint, userId);
    const now = Date.now();
    const windowMs = limit.windowMinutes * 60 * 1000;
    const windowStart = now - windowMs;

    // Remove timestamps outside the window
    await this.redis.zremrangebyscore(key, 0, windowStart);

    // Count requests in current window
    const count = await this.redis.zcard(key);

    if (count >= limit.requests) {
      // Rate limit exceeded - calculate retry time
      const oldestTimestamp = await this.redis.zrange(key, 0, 0, "WITHSCORES");
      const oldestTime = oldestTimestamp[1] ? parseInt(oldestTimestamp[1]) : now;
      const retryAfter = Math.ceil((oldestTime + windowMs - now) / 1000); // seconds

      return { allowed: false, retryAfter };
    }

    return { allowed: true, retryAfter: null };
  }

  /**
   * Record that a request was made
   */
  async recordRequest(endpoint, userId) {
    const limit = RATE_LIMITS[endpoint];
    if (!limit) {
      return; // No tracking needed
    }

    const key = this.getKey(endpoint, userId);
    const now = Date.now();
    const callId = `${now}_${Math.random().toString(36).substring(7)}`;

    // Add current timestamp to sorted set
    await this.redis.zadd(key, now, callId);

    // Set expiry on the key to clean up old data
    const windowMs = limit.windowMinutes * 60 * 1000;
    await this.redis.expire(key, Math.ceil(windowMs / 1000) + 60); // Add 1 min buffer
  }

  /**
   * Get current rate limit status for an endpoint and user
   */
  async getStatus(endpoint, userId) {
    const limit = RATE_LIMITS[endpoint];
    if (!limit) {
      return null;
    }

    const key = this.getKey(endpoint, userId);
    const now = Date.now();
    const windowMs = limit.windowMinutes * 60 * 1000;
    const windowStart = now - windowMs;

    // Clean up old entries
    await this.redis.zremrangebyscore(key, 0, windowStart);

    // Get current count
    const count = await this.redis.zcard(key);
    const remaining = Math.max(0, limit.requests - count);

    return {
      endpoint,
      limit: limit.requests,
      remaining,
      windowMinutes: limit.windowMinutes,
      resetAt: new Date(now + windowMs).toISOString(),
    };
  }

  /**
   * Clear rate limit for testing/debugging
   */
  async clearRateLimit(endpoint, userId) {
    const key = this.getKey(endpoint, userId);
    await this.redis.del(key);
  }

  /**
   * Wait if rate limited, then execute function
   * Automatically checks, waits if needed, records, and executes
   */
  async executeWithRateLimit(endpoint, userId, fn) {
    const check = await this.checkRateLimit(endpoint, userId);

    if (!check.allowed) {
      console.warn(
        `[Rate Limiter] Rate limit exceeded for ${endpoint} (user ${userId}). ` +
        `Retry after ${check.retryAfter}s`
      );
      throw new Error(
        `Rate limit exceeded for ${endpoint}. Retry after ${check.retryAfter} seconds.`
      );
    }

    // Record the request
    await this.recordRequest(endpoint, userId);

    // Execute the function
    return await fn();
  }
}

export default new RateLimiter();
