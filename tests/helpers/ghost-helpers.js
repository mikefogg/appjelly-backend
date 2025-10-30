/**
 * Ghost-specific test helpers
 */

import request from "supertest";
import { knex } from "#src/models/index.js";
import { App, Account, ConnectedAccount, NetworkProfile, NetworkPost, PostSuggestion, WritingStyle } from "#src/models/index.js";

/**
 * Create a Ghost app for testing
 */
export async function createGhostApp(overrides = {}) {
  return await App.query()
    .insert({
      slug: overrides.slug || "ghost",
      name: overrides.name || "Ghost",
      config: {
        features: {
          twitter: true,
          threads: false,
          linkedin: false,
        },
        limits: {
          max_connected_accounts_per_platform: 1,
          daily_suggestions: 3,
          sync_interval_hours: 24,
        },
        ...overrides.config,
      },
    })
    .onConflict('slug')
    .merge();
}

/**
 * Create a test account
 */
export async function createAccount(app, overrides = {}) {
  return await Account.query()
    .insert({
      clerk_id: overrides.clerk_id || "user_test123",
      email: overrides.email || "test@example.com",
      app_id: app.id,
      name: overrides.name || "Test User",
      metadata: overrides.metadata || {},
    })
    .onConflict(['clerk_id', 'app_id'])
    .merge();
}

/**
 * Create a connected Twitter account
 */
export async function createConnectedAccount(account, app, overrides = {}) {
  return await ConnectedAccount.query()
    .insert({
      account_id: account.id,
      app_id: app.id,
      platform: overrides.platform || "twitter",
      platform_user_id: overrides.platform_user_id || "twitter_123",
      username: overrides.username || "testuser",
      display_name: overrides.display_name || "Test User",
      access_token: overrides.access_token || "test_access_token",
      refresh_token: overrides.refresh_token || "test_refresh_token",
      sync_status: overrides.sync_status || "ready",
      profile_data: overrides.profile_data || {},
      last_synced_at: overrides.last_synced_at || new Date().toISOString(),
      metadata: overrides.metadata || {},
    })
    .onConflict(['account_id', 'platform', 'platform_user_id'])
    .merge();
}

/**
 * Create network profiles (people the user follows)
 */
export async function createNetworkProfiles(connectedAccount, count = 2) {
  const profiles = [];
  for (let i = 0; i < count; i++) {
    const profile = await NetworkProfile.query().insert({
      connected_account_id: connectedAccount.id,
      platform: connectedAccount.platform,
      platform_user_id: `user${i + 1}`,
      username: `influencer${i + 1}`,
      display_name: `Influencer ${i + 1}`,
      bio: `Bio for influencer ${i + 1}`,
      follower_count: 10000 * (i + 1),
      following_count: 500 * (i + 1),
      is_verified: i === 0,
      engagement_score: 100 * (i + 1),
      relevance_score: 90 * (i + 1),
    });
    profiles.push(profile);
  }
  return profiles;
}

/**
 * Create network posts (posts from people the user follows)
 */
export async function createNetworkPosts(connectedAccount, networkProfile, count = 3) {
  const posts = [];
  for (let i = 0; i < count; i++) {
    const post = await NetworkPost.query().insert({
      connected_account_id: connectedAccount.id,
      network_profile_id: networkProfile.id,
      platform: connectedAccount.platform,
      post_id: `post${i + 1}`,
      content: `This is post ${i + 1} about tech and AI #tech #ai`,
      posted_at: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      reply_count: i * 2,
      retweet_count: i * 5,
      like_count: i * 10,
      quote_count: i,
      engagement_score: i * 20,
      topics: ['tech', 'ai'],
      sentiment: "positive",
    });
    posts.push(post);
  }
  return posts;
}

/**
 * Create post suggestions
 */
export async function createPostSuggestions(account, connectedAccount, app, count = 3) {
  const suggestions = [];
  for (let i = 0; i < count; i++) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const suggestion = await PostSuggestion.query().insert({
      account_id: account.id,
      connected_account_id: connectedAccount.id,
      app_id: app.id,
      suggestion_type: i === 0 ? "reply" : "original_post",
      content: `Suggestion ${i + 1}: Great insight about AI!`,
      reasoning: `This is relevant because ${i + 1}`,
      topics: ['ai', 'tech'],
      character_count: 40 + i,
      expires_at: expiresAt.toISOString(),
      status: "pending",
    });
    suggestions.push(suggestion);
  }
  return suggestions;
}

/**
 * Create writing style for a connected account
 */
export async function createWritingStyle(connectedAccount, overrides = {}) {
  return await WritingStyle.query().insertAndFetch({
    connected_account_id: connectedAccount.id,
    tone: overrides.tone || "casual and conversational",
    avg_length: overrides.avg_length || 150,
    emoji_frequency: overrides.emoji_frequency || 0.3,
    hashtag_frequency: overrides.hashtag_frequency || 0.2,
    question_frequency: overrides.question_frequency || 0.1,
    common_phrases: overrides.common_phrases || ["I think", "hot take", "heres the thing"],
    common_topics: overrides.common_topics || ["tech", "ai", "startups"],
    posting_times: overrides.posting_times || [9, 12, 15, 18],
    style_summary: overrides.style_summary || "Casual and thoughtful. Uses clear language with occasional humor.",
    sample_size: overrides.sample_size || 50,
    confidence_score: overrides.confidence_score || 0.85,
    analyzed_at: overrides.analyzed_at || new Date().toISOString(),
  });
}

/**
 * Make an authenticated request (authenticated user with connected account)
 */
export function authenticatedRequest(app, method, url, userId = "user_test123", appSlug = "ghost") {
  return request(app)[method](url)
    .set("X-Test-User-Id", userId)
    .set("X-App-Slug", appSlug);
}

/**
 * Make an unauthenticated request
 */
export function unauthenticatedRequest(app, method, url, appSlug = "ghost") {
  return request(app)[method](url)
    .set("X-App-Slug", appSlug);
}

/**
 * Create full test context (app, account, connected account)
 */
export async function createTestContext(options = {}) {
  const app = await createGhostApp(options.app);
  const account = await createAccount(app, {
    clerk_id: options.userId || "user_test123",
    ...options.account,
  });
  const connectedAccount = await createConnectedAccount(account, app, options.connectedAccount);

  return {
    app,
    account,
    connectedAccount,
  };
}

/**
 * Create full test context with network data
 */
export async function createTestContextWithNetwork(options = {}) {
  const context = await createTestContext(options);

  const profiles = await createNetworkProfiles(context.connectedAccount, 2);
  const posts = await createNetworkPosts(context.connectedAccount, profiles[0], 3);
  const writingStyle = await createWritingStyle(context.connectedAccount);

  return {
    ...context,
    profiles,
    posts,
    writingStyle,
  };
}
