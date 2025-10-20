import { ghostQueue, JOB_GENERATE_SUGGESTIONS, JOB_GENERATE_SUGGESTIONS_AUTOMATED } from "#src/background/queues/index.js";
import { ConnectedAccount } from "#src/models/index.js";

console.log("⏰ Setting up suggestion generation schedulers...");

// Schedule automatic suggestion generation to run every hour
const scheduleHourlySuggestions = async () => {
  try {
    // Remove any existing scheduled jobs for this type
    const existingJobs = await ghostQueue.getRepeatableJobs();
    const suggestionJobs = existingJobs.filter(job => job.name === JOB_GENERATE_SUGGESTIONS_AUTOMATED);

    for (const job of suggestionJobs) {
      await ghostQueue.removeRepeatableByKey(job.key);
      console.log("🗑️ Removed existing hourly suggestion generation schedule");
    }

    // Add new repeatable job - every hour
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

    console.log("✅ Scheduled hourly suggestion generation job");
  } catch (error) {
    console.error("❌ Failed to schedule hourly suggestions:", error);
  }
};

// Schedule all suggestion jobs
const setupSuggestionSchedules = async () => {
  await scheduleHourlySuggestions();

  console.log("✅ All suggestion schedules configured");
};

// Initialize schedules
setupSuggestionSchedules().catch(error => {
  console.error("❌ Failed to setup suggestion schedules:", error);
  process.exit(1);
});

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

console.log("✅ Suggestion scheduler setup complete");
