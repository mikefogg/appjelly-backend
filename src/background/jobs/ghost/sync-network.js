/**
 * Sync Network Job
 * Syncs Twitter network data (following, their posts) for a connected account
 */

import { ConnectedAccount, NetworkProfile, NetworkPost } from "#src/models/index.js";
import twitterService from "#src/services/twitter.js";

export const JOB_SYNC_NETWORK = "sync-network";

export default async function syncNetwork(job) {
  const { connectedAccountId } = job.data;

  console.log(`[Sync Network] Starting sync for connected account: ${connectedAccountId}`);

  try {
    // Get connected account
    const connectedAccount = await ConnectedAccount.query().findById(connectedAccountId);

    if (!connectedAccount) {
      throw new Error(`Connected account ${connectedAccountId} not found`);
    }

    if (!connectedAccount.access_token) {
      throw new Error(`Connected account ${connectedAccountId} has no access token`);
    }

    // Mark as syncing
    await connectedAccount.markAsSyncing();

    const { access_token, platform_user_id } = connectedAccount;

    // Step 1: Sync following list
    console.log(`[Sync Network] Fetching following list...`);
    const following = await twitterService.getFollowing(access_token, platform_user_id, {
      maxResults: 1000,
    });

    console.log(`[Sync Network] Found ${following.length} accounts in network`);

    // Save or update network profiles
    let profilesSynced = 0;
    for (const profile of following) {
      try {
        await NetworkProfile.query()
          .insert({
            connected_account_id: connectedAccount.id,
            platform: connectedAccount.platform,
            platform_user_id: profile.platform_user_id,
            username: profile.username,
            display_name: profile.display_name,
            bio: profile.bio,
            follower_count: profile.follower_count,
            following_count: profile.following_count,
            is_verified: profile.is_verified,
            profile_image_url: profile.profile_image_url,
            profile_data: profile.profile_data,
            last_synced_at: new Date().toISOString(),
          })
          .onConflict(["connected_account_id", "platform_user_id"])
          .merge([
            "username",
            "display_name",
            "bio",
            "follower_count",
            "following_count",
            "is_verified",
            "profile_image_url",
            "profile_data",
            "last_synced_at",
          ]);

        profilesSynced++;
      } catch (error) {
        console.warn(`Failed to sync profile ${profile.username}:`, error.message);
      }
    }

    job.updateProgress(30);
    console.log(`[Sync Network] Synced ${profilesSynced} profiles`);

    // Step 2: Fetch recent posts from timeline
    console.log(`[Sync Network] Fetching home timeline...`);
    const { tweets } = await twitterService.getHomeTimeline(access_token, platform_user_id, {
      maxResults: 100,
    });

    console.log(`[Sync Network] Found ${tweets.length} recent posts`);

    // Save posts
    let postsSynced = 0;
    for (const tweet of tweets) {
      try {
        // Find the network profile for this author
        const authorProfile = await NetworkProfile.query()
          .where("connected_account_id", connectedAccount.id)
          .where("platform_user_id", tweet.author_id)
          .first();

        if (!authorProfile) {
          console.warn(`Author profile not found for ${tweet.author_username}`);
          continue;
        }

        // Extract topics and sentiment
        const topics = twitterService.extractTopics(tweet.content);
        const sentiment = twitterService.analyzeSentiment(tweet.content);
        const engagementScore = twitterService.calculateEngagement({
          reply_count: tweet.reply_count,
          retweet_count: tweet.retweet_count,
          like_count: tweet.like_count,
          quote_count: tweet.quote_count,
        });

        await NetworkPost.query()
          .insert({
            connected_account_id: connectedAccount.id,
            network_profile_id: authorProfile.id,
            platform: connectedAccount.platform,
            post_id: tweet.post_id,
            content: tweet.content,
            posted_at: tweet.posted_at,
            reply_count: tweet.reply_count,
            retweet_count: tweet.retweet_count,
            like_count: tweet.like_count,
            quote_count: tweet.quote_count || 0,
            engagement_score: engagementScore,
            topics,
            sentiment,
          })
          .onConflict(["connected_account_id", "post_id"])
          .merge([
            "reply_count",
            "retweet_count",
            "like_count",
            "quote_count",
            "engagement_score",
          ]);

        postsSynced++;
      } catch (error) {
        console.warn(`Failed to sync post ${tweet.post_id}:`, error.message);
      }
    }

    job.updateProgress(80);
    console.log(`[Sync Network] Synced ${postsSynced} posts`);

    // Step 3: Calculate engagement scores for network profiles
    console.log(`[Sync Network] Calculating engagement scores...`);
    const profiles = await NetworkProfile.query()
      .where("connected_account_id", connectedAccount.id);

    for (const profile of profiles) {
      const posts = await NetworkPost.query()
        .where("network_profile_id", profile.id)
        .where("posted_at", ">", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()); // Last 30 days

      if (posts.length > 0) {
        const avgEngagement = posts.reduce((sum, p) => sum + (p.engagement_score || 0), 0) / posts.length;

        await profile.$query().patch({
          engagement_score: avgEngagement,
          relevance_score: avgEngagement, // Can be more sophisticated
        });
      }
    }

    job.updateProgress(95);

    // Mark as ready
    await connectedAccount.markAsReady();

    job.updateProgress(100);

    console.log(`[Sync Network] Sync completed successfully`);

    return {
      success: true,
      profiles_synced: profilesSynced,
      posts_synced: postsSynced,
      completed_at: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[Sync Network] Error:`, error);

    // Mark connected account as error
    try {
      const connectedAccount = await ConnectedAccount.query().findById(connectedAccountId);
      if (connectedAccount) {
        await connectedAccount.markAsError(error.message);
      }
    } catch (updateError) {
      console.error("Failed to update connected account error status:", updateError);
    }

    throw error; // Re-throw to trigger job retry
  }
}
