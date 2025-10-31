/**
 * Automated Suggestions Generation Job
 * Runs hourly to generate suggestions for accounts scheduled for this UTC hour
 */

import { Account, ConnectedAccount } from "#src/models/index.js";
import { ghostQueue, JOB_GENERATE_SUGGESTIONS } from "#src/background/queues/index.js";

export const JOB_GENERATE_SUGGESTIONS_AUTOMATED = "generate-suggestions-automated";

export default async function generateSuggestionsAutomated(job) {
  const currentUTCHour = new Date().getUTCHours();
  console.log(`[Generate Suggestions Automated] Starting automated generation cycle for UTC hour ${currentUTCHour}`);

  try {
    // Get accounts scheduled for this UTC hour
    const scheduledAccounts = await Account.query()
      .where("generation_time_utc", currentUTCHour)
      .whereNotNull("timezone");

    console.log(`[Generate Suggestions Automated] Found ${scheduledAccounts.length} accounts scheduled for ${currentUTCHour}:00 UTC`);

    if (scheduledAccounts.length === 0) {
      return {
        success: true,
        message: `No accounts scheduled for ${currentUTCHour}:00 UTC`,
        accounts_processed: 0,
        current_utc_hour: currentUTCHour,
      };
    }

    // Get all connected accounts for these scheduled accounts
    const accountIds = scheduledAccounts.map(acc => acc.id);
    const eligibleConnections = await ConnectedAccount.query()
      .whereIn("account_id", accountIds)
      .where("is_active", true)
      .modify((qb) => {
        qb.where((builder) => {
          builder
            .where("sync_status", "ready") // Network platforms that are synced
            .orWhere("platform", "ghost"); // Or all ghost platforms
        });
      });

    console.log(`[Generate Suggestions Automated] Found ${eligibleConnections.length} eligible connected accounts from ${scheduledAccounts.length} scheduled accounts`);

    if (eligibleConnections.length === 0) {
      return {
        success: true,
        message: `Found ${scheduledAccounts.length} scheduled accounts but no eligible connected accounts`,
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
      accounts_scheduled: scheduledAccounts.length,
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
