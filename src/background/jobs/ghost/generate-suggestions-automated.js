/**
 * Automated Suggestions Generation Job
 * Runs hourly to generate suggestions for connections scheduled for this UTC hour
 * Supports both account-level scheduling and connection-level overrides
 * Free users: Limited to 10 posts per connection, excludes connections at limit
 * Paid users: Unlimited
 */

import { Account, ConnectedAccount, Subscription } from "#src/models/index.js";
import { ghostQueue, JOB_GENERATE_SUGGESTIONS } from "#src/background/queues/index.js";
import { trackEvent } from "#src/helpers/track.js";
import { FREEMIUM_CONFIG } from "#src/config/freemium.js";

export const JOB_GENERATE_SUGGESTIONS_AUTOMATED = "generate-suggestions-automated";

export default async function generateSuggestionsAutomated(job) {
  const currentUTCHour = new Date().getUTCHours();
  console.log(`[Generate Suggestions Automated] Starting automated generation cycle for UTC hour ${currentUTCHour}`);

  try {
    // Strategy: Find eligible connections in two ways:
    // 1. Connections with their own generation_time_utc matching current hour
    // 2. Connections without override, where parent account's generation_time_utc matches
    // Free users can now be scheduled (up to their limit)

    // Get all active subscriptions to know which accounts are paid
    const allActiveSubscriptions = await Subscription.query().modify("active");
    const subscribedAccountIds = new Set(allActiveSubscriptions.map(sub => sub.account_id));

    // Get accounts scheduled for this hour (all accounts, not just subscribed)
    const scheduledAccounts = await Account.query()
      .where("generation_time_utc", currentUTCHour)
      .whereNotNull("timezone");

    const accountScheduledIds = scheduledAccounts.map(acc => acc.id);

    if (accountScheduledIds.length === 0) {
      // No accounts scheduled for this hour - check for connection-level overrides
      const connectionsWithOverride = await ConnectedAccount.query()
        .where("is_active", true)
        .where("generation_time_utc", currentUTCHour)
        .count("* as count")
        .first();

      if (parseInt(connectionsWithOverride?.count || 0, 10) === 0) {
        return {
          success: true,
          message: `No accounts or connections scheduled for ${currentUTCHour}:00 UTC`,
          accounts_processed: 0,
          current_utc_hour: currentUTCHour,
        };
      }
    }

    // Find eligible connections:
    // - Has connection-level override matching current hour, OR
    // - No override AND parent account scheduled for current hour
    // Exclude free users who have reached the generation limit
    const eligibleConnections = await ConnectedAccount.query()
      .where("is_active", true)
      .where(function() {
        // Connection has its own schedule matching current hour
        this.where("generation_time_utc", currentUTCHour)
          // OR connection has no override and account is scheduled now
          .orWhere(function() {
            this.whereNull("generation_time_utc")
              .whereIn("account_id", accountScheduledIds);
          });
      })
      .modify((qb) => {
        qb.where((builder) => {
          builder
            .where("sync_status", "ready") // Network platforms that are synced
            .orWhere("platform", "ghost"); // Or all ghost platforms
        });
      });

    // Filter out free users who have reached the generation limit
    const filteredConnections = eligibleConnections.filter(conn => {
      // If subscribed, always eligible
      if (subscribedAccountIds.has(conn.account_id)) return true;
      // If free user, check generation limit
      return (conn.generated_posts_count || 0) < FREEMIUM_CONFIG.FREE_POSTS_PER_CONNECTION;
    });

    const atLimitCount = eligibleConnections.length - filteredConnections.length;

    const connectionsWithOverride = filteredConnections.filter(c => c.generation_time_utc !== null).length;
    const connectionsFromAccount = filteredConnections.length - connectionsWithOverride;
    const paidConnections = filteredConnections.filter(c => subscribedAccountIds.has(c.account_id)).length;
    const freeConnections = filteredConnections.length - paidConnections;

    console.log(`[Generate Suggestions Automated] Found ${filteredConnections.length} eligible connections for ${currentUTCHour}:00 UTC`);
    console.log(`[Generate Suggestions Automated]   - ${connectionsWithOverride} with connection-level override`);
    console.log(`[Generate Suggestions Automated]   - ${connectionsFromAccount} from account-level schedule`);
    console.log(`[Generate Suggestions Automated]   - ${paidConnections} paid, ${freeConnections} free`);
    if (atLimitCount > 0) {
      console.log(`[Generate Suggestions Automated]   - ${atLimitCount} skipped (at generation limit)`);
    }

    if (filteredConnections.length === 0) {
      return {
        success: true,
        message: `No connections scheduled for ${currentUTCHour}:00 UTC`,
        accounts_processed: 0,
        current_utc_hour: currentUTCHour,
        skipped_at_limit: atLimitCount,
      };
    }

    job.updateProgress(20);

    // Queue individual suggestion generation jobs for each connected account
    const queuedJobs = [];
    let successCount = 0;
    let failureCount = 0;

    for (const connection of filteredConnections) {
      try {
        const suggestionJob = await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, {
          connectedAccountId: connection.id,
          suggestionCount: 3,
          automated: true,
          triggeredAt: new Date().toISOString(),
        });

        queuedJobs.push({
          connectedAccountId: connection.id,
          accountId: connection.account_id,
          platform: connection.platform,
          jobId: suggestionJob.id,
        });

        // Track for this account
        trackEvent(connection.account_id, "Suggestions Auto-Generated", {
          connected_account_id: connection.id,
          platform: connection.platform,
          suggestion_count: 3,
          utc_hour: currentUTCHour,
          has_override: connection.generation_time_utc !== null,
        });

        successCount++;
      } catch (error) {
        console.warn(`[Generate Suggestions Automated] Failed to queue for connection ${connection.id}:`, error.message);
        failureCount++;
      }
    }

    job.updateProgress(100);

    console.log(`[Generate Suggestions Automated] Completed: ${successCount} queued, ${failureCount} failed for UTC hour ${currentUTCHour}`);

    return {
      success: true,
      current_utc_hour: currentUTCHour,
      connections_with_override: connectionsWithOverride,
      connections_from_account: connectionsFromAccount,
      connections_found: filteredConnections.length,
      connections_paid: paidConnections,
      connections_free: freeConnections,
      skipped_at_limit: atLimitCount,
      jobs_queued: successCount,
      failures: failureCount,
      queued_jobs: queuedJobs,
      completed_at: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`[Generate Suggestions Automated] Error:`, error);
    throw error;
  }
}
