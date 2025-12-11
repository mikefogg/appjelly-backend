/**
 * Manually trigger voice profile regeneration for a connected account
 * Usage: npm run regenerate-voice <connection_id> [--use-latest-feedback]
 */

import { ghostQueue, JOB_GENERATE_VOICE_PROFILE, JOB_PROCESS_VOICE_FEEDBACK } from "../src/background/queues/index.js";
import { ConnectedAccount, VoiceFeedback } from "../src/models/index.js";

const args = process.argv.slice(2);
const connectionId = args.find(arg => !arg.startsWith("--"));
const useLatestFeedback = args.includes("--use-latest-feedback");

if (!connectionId) {
  console.error("❌ Error: Please provide a connection ID");
  console.log("Usage: npm run regenerate-voice <connection_id> [--use-latest-feedback]");
  console.log("  --use-latest-feedback  Re-process the most recent feedback instead of full regeneration");
  process.exit(1);
}

async function regenerateVoice() {
  try {
    // Verify connection exists
    const connection = await ConnectedAccount.query().findById(connectionId);
    if (!connection) {
      console.error(`❌ Connection ${connectionId} not found`);
      process.exit(1);
    }

    console.log(`✅ Found connection: ${connection.username} (${connection.platform})`);

    if (useLatestFeedback) {
      // Find most recent feedback
      const latestFeedback = await VoiceFeedback.query()
        .where("connected_account_id", connectionId)
        .orderBy("created_at", "desc")
        .first();

      if (!latestFeedback) {
        console.error(`❌ No feedback found for this connection`);
        process.exit(1);
      }

      console.log(`🔄 Re-processing feedback: "${latestFeedback.feedback.substring(0, 50)}..."`);

      // Reset feedback to pending so it can be reprocessed
      await latestFeedback.$query().patch({ status: "pending" });

      const job = await ghostQueue.add(JOB_PROCESS_VOICE_FEEDBACK, {
        feedbackId: latestFeedback.id,
      });

      console.log(`✅ Feedback job queued (ID: ${job.id})`);
    } else {
      console.log(`🔄 Triggering full voice profile regeneration...`);

      const job = await ghostQueue.add(JOB_GENERATE_VOICE_PROFILE, {
        connectedAccountId: connectionId,
        force: true,
      });

      console.log(`✅ Job queued successfully (ID: ${job.id})`);
    }

    console.log(`📊 Monitor job status in the ghost worker logs`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

regenerateVoice();
