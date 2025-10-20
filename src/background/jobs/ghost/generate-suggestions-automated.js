/**
 * Automated Suggestions Generation Job
 * Runs hourly to generate suggestions for all active connected accounts
 */

import { ConnectedAccount } from "#src/models/index.js";
import { ghostQueue, JOB_GENERATE_SUGGESTIONS } from "#src/background/queues/index.js";

export const JOB_GENERATE_SUGGESTIONS_AUTOMATED = "generate-suggestions-automated";

export default async function generateSuggestionsAutomated(job) {
  console.log(`[Generate Suggestions Automated] Starting automated generation cycle`);

  try {
    // Get all active connected accounts that are ready for suggestion generation
    // - Network platforms: Must have sync_status = "ready"
    // - Ghost platforms: Always included (will check for topics or sample posts in job)
    const eligibleAccounts = await ConnectedAccount.query()
      .where("is_active", true)
      .modify((qb) => {
        qb.where((builder) => {
          builder
            .where("sync_status", "ready") // Network platforms that are synced
            .orWhere("platform", "ghost"); // Or all ghost platforms
        });
      });

    console.log(`[Generate Suggestions Automated] Found ${eligibleAccounts.length} eligible accounts`);

    if (eligibleAccounts.length === 0) {
      return {
        success: true,
        message: "No eligible accounts found",
        accounts_processed: 0,
      };
    }

    job.updateProgress(20);

    // Queue individual suggestion generation jobs for each account
    const queuedJobs = [];
    let successCount = 0;
    let failureCount = 0;

    for (const account of eligibleAccounts) {
      try {
        const suggestionJob = await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, {
          connectedAccountId: account.id,
          suggestionCount: 3,
          automated: true,
          triggeredAt: new Date().toISOString(),
        });

        queuedJobs.push({
          accountId: account.id,
          platform: account.platform,
          jobId: suggestionJob.id,
        });

        successCount++;
      } catch (error) {
        console.warn(`[Generate Suggestions Automated] Failed to queue for account ${account.id}:`, error.message);
        failureCount++;
      }
    }

    job.updateProgress(100);

    console.log(`[Generate Suggestions Automated] Completed: ${successCount} queued, ${failureCount} failed`);

    return {
      success: true,
      accounts_found: eligibleAccounts.length,
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
