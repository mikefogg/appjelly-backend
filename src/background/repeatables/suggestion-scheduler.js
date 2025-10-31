import chalk from "chalk";
import { ghostQueue, JOB_GENERATE_SUGGESTIONS, JOB_GENERATE_SUGGESTIONS_AUTOMATED } from "#src/background/queues/index.js";
import { clearAllRepeatableJobs } from "#src/utils/redis.js";
import { ConnectedAccount } from "#src/models/index.js";

const key = "Suggestion Scheduler";

export const startScheduledJobs = async () => {
  try {
    // Add repeatable job - every hour
    await ghostQueue.add(
      JOB_GENERATE_SUGGESTIONS_AUTOMATED,
      {
        triggeredAt: new Date().toISOString(),
      },
      {
        repeat: {
          pattern: "0 * * * *", // Every hour at minute 0
        },
        jobId: "hourly-suggestion-generation-automated",
        removeOnComplete: 10,
        removeOnFail: 20,
      }
    );

    console.log(chalk.green("[%s] Scheduled hourly suggestion generation job"), key);
  } catch (error) {
    console.error(chalk.red("[%s] Failed to schedule suggestions"), key, error);
    throw error;
  }
};

export const resetScheduledJobs = async () => {
  try {
    // Clear all of our repeatables first
    await clearAllRepeatableJobs(ghostQueue);
    console.log(chalk.dim("[%s] Cleared repeatable jobs..."), key);

    // Small delay to ensure Redis consistency after clearing
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (error) {
    console.error(chalk.red("[%s] Failed to reset scheduled jobs"), key, error);
    throw error;
  }
};

// Helper function to manually trigger suggestion generation for all accounts
export const triggerManualSuggestionsForAll = async () => {
  try {
    // Get all active connected accounts that are ready
    const accounts = await ConnectedAccount.query()
      .where("is_active", true)
      .modify((qb) => {
        qb.where((builder) => {
          builder
            .where("sync_status", "ready") // Network platforms that are synced
            .orWhere((b) => {
              b.where("platform", "ghost") // Or ghost platforms with topics
                .whereNotNull("topics_of_interest");
            });
        });
      });

    console.log(`🚀 Triggering suggestion generation for ${accounts.length} accounts...`);

    const jobs = [];
    for (const account of accounts) {
      const job = await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, {
        connectedAccountId: account.id,
        suggestionCount: 3,
        manual: true,
        triggeredAt: new Date().toISOString(),
      });
      jobs.push(job);
    }

    console.log(`✅ Queued ${jobs.length} suggestion generation jobs`);
    return jobs;
  } catch (error) {
    console.error("❌ Failed to trigger manual suggestions for all:", error);
    throw error;
  }
};

// Helper to check scheduled suggestion jobs
export const getScheduledSuggestionJobs = async () => {
  try {
    const repeatableJobs = await ghostQueue.getRepeatableJobs();
    return repeatableJobs
      .filter(job => job.name === JOB_GENERATE_SUGGESTIONS_AUTOMATED)
      .map(job => ({
        name: job.name,
        pattern: job.cron,
        next: job.next,
        key: job.key,
      }));
  } catch (error) {
    console.error("❌ Failed to get scheduled suggestion jobs:", error);
    return [];
  }
};
