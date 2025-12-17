/**
 * Admin Task: Regenerate Voice Profile
 *
 * Triggers voice profile regeneration for a connected account.
 * Bypasses threshold check and forces regeneration.
 *
 * Usage:
 *   node tasks/admin/regenerate-voice-profile.js <connected_account_id>
 *   node tasks/admin/regenerate-voice-profile.js --account <account_id>  (all connections)
 *
 * Examples:
 *   node tasks/admin/regenerate-voice-profile.js abc-123-def
 *   node tasks/admin/regenerate-voice-profile.js --account user_abc123
 */

import { Account, ConnectedAccount } from "#src/models/index.js";
import { ghostQueue, JOB_GENERATE_VOICE_PROFILE } from "#src/background/queues/index.js";
import { knex } from "#src/models/index.js";

async function regenerateVoiceProfile() {
  try {
    const args = process.argv.slice(2);

    if (args.length === 0) {
      console.log("Usage:");
      console.log("  node tasks/admin/regenerate-voice-profile.js <connected_account_id>");
      console.log("  node tasks/admin/regenerate-voice-profile.js --account <account_id>");
      process.exit(1);
    }

    let connectedAccounts = [];

    // Check if --account flag is used
    if (args[0] === "--account") {
      const accountId = args[1];
      if (!accountId) {
        console.error("Error: --account requires an account ID");
        process.exit(1);
      }

      const account = await Account.query().findById(accountId);
      if (!account) {
        console.error(`Error: Account ${accountId} not found`);
        process.exit(1);
      }

      connectedAccounts = await ConnectedAccount.query()
        .where("account_id", accountId)
        .where("is_active", true);

      console.log(`[Regenerate Voice] Found ${connectedAccounts.length} active connections for account ${accountId}`);
    } else {
      // Single connected account ID
      const connectedAccountId = args[0];
      const connection = await ConnectedAccount.query().findById(connectedAccountId);

      if (!connection) {
        console.error(`Error: Connected account ${connectedAccountId} not found`);
        process.exit(1);
      }

      connectedAccounts = [connection];
    }

    if (connectedAccounts.length === 0) {
      console.log("No connections to process");
      process.exit(0);
    }

    // Queue regeneration for each connection
    let queued = 0;
    for (const connection of connectedAccounts) {
      const score = await connection.getVoiceMatchScore();

      console.log(`\n[Regenerate Voice] Connection: ${connection.id}`);
      console.log(`  Platform: ${connection.platform}`);
      console.log(`  Label: ${connection.label || "(none)"}`);
      console.log(`  Voice Match Score: ${score}%`);

      // Mark voice update started
      await connection.markVoiceUpdateStarted();

      // Queue the job with force flag to bypass hash check
      await ghostQueue.add(
        JOB_GENERATE_VOICE_PROFILE,
        {
          connectedAccountId: connection.id,
          force: true,
          reason: "admin_regenerate",
        },
        {
          jobId: `admin-regen-voice-${connection.id}-${Date.now()}`,
        }
      );

      console.log(`  ✓ Queued voice profile regeneration`);
      queued++;
    }

    console.log(`\n[Regenerate Voice] ✅ Queued ${queued} job(s)`);
    console.log("Jobs will be processed by the worker.");

  } catch (error) {
    console.error("[Regenerate Voice] ❌ Error:", error);
    throw error;
  } finally {
    await knex.destroy();
  }
}

regenerateVoiceProfile();
