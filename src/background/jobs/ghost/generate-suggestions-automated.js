/**
 * Automated Suggestions Generation Job
 * Runs hourly to generate suggestions for connections scheduled for this UTC hour
 * Supports both account-level scheduling and connection-level overrides
 * Only generates for accounts with active subscriptions
 */

import { Account, ConnectedAccount, Subscription } from "#src/models/index.js";
import { ghostQueue, JOB_GENERATE_SUGGESTIONS } from "#src/background/queues/index.js";
import { trackEvent } from "#src/helpers/track.js";

export const JOB_GENERATE_SUGGESTIONS_AUTOMATED = "generate-suggestions-automated";

export default async function generateSuggestionsAutomated(job) {
  const currentUTCHour = new Date().getUTCHours();
  console.log(`[Generate Suggestions Automated] Starting automated generation cycle for UTC hour ${currentUTCHour}`);

  try {
    // Strategy: Find eligible connections in two ways:
    // 1. Connections with their own generation_time_utc matching current hour
    // 2. Connections without override, where parent account's generation_time_utc matches

    // First, get all accounts with active subscriptions
    const allActiveSubscriptions = await Subscription.query().modify("active");
    const subscribedAccountIds = [...new Set(allActiveSubscriptions.map(sub => sub.account_id))];

    if (subscribedAccountIds.length === 0) {
      return {
        success: true,
        message: "No accounts with active subscriptions",
        accounts_processed: 0,
        current_utc_hour: currentUTCHour,
      };
    }

    // Get accounts scheduled for this hour (for connections without override)
    const scheduledAccounts = await Account.query()
      .whereIn("id", subscribedAccountIds)
      .where("generation_time_utc", currentUTCHour)
      .whereNotNull("timezone");

    const accountScheduledIds = scheduledAccounts.map(acc => acc.id);

    // Find eligible connections:
    // - Has connection-level override matching current hour, OR
    // - No override AND parent account scheduled for current hour
    const eligibleConnections = await ConnectedAccount.query()
      .whereIn("account_id", subscribedAccountIds)
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

    const connectionsWithOverride = eligibleConnections.filter(c => c.generation_time_utc !== null).length;
    const connectionsFromAccount = eligibleConnections.length - connectionsWithOverride;

    console.log(`[Generate Suggestions Automated] Found ${eligibleConnections.length} eligible connections for ${currentUTCHour}:00 UTC`);
    console.log(`[Generate Suggestions Automated]   - ${connectionsWithOverride} with connection-level override`);
    console.log(`[Generate Suggestions Automated]   - ${connectionsFromAccount} from account-level schedule`);

    if (eligibleConnections.length === 0) {
      return {
        success: true,
        message: `No connections scheduled for ${currentUTCHour}:00 UTC`,
        accounts_processed: 0,
        current_utc_hour: currentUTCHour,
      };
    }

    job.updateProgress(20);

    // Queue individual suggestion generation jobs for each connected account
    const queuedJobs = [];
    let successCount = 0;
    let failureCount = 0;

    for (const connection of eligibleConnections) {
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
      connections_found: eligibleConnections.length,
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
