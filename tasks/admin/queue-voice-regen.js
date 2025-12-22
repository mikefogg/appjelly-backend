/**
 * Queue voice profile regeneration for a connected account
 *
 * Usage:
 *   node tasks/admin/queue-voice-regen.js <connected_account_id>
 *   node tasks/admin/queue-voice-regen.js <connected_account_id> --force
 */

import { ConnectedAccount, knex } from "#src/models/index.js";
import {
  ghostQueue,
  JOB_GENERATE_VOICE_PROFILE,
} from "#src/background/queues/index.js";

async function main() {
  try {
    const args = process.argv.slice(2);
    const userId = args.find(arg => !arg.startsWith("--"));
    const force = args.includes("--force");

    if (!userId) {
      console.error("Usage: node tasks/admin/queue-voice-regen.js <connected_account_id> [--force]");
      process.exit(1);
    }

    const account = await ConnectedAccount.query().findById(userId);
    if (!account) {
      console.error(`Connected account ${userId} not found`);
      process.exit(1);
    }

    console.log(`Queuing voice regeneration for ${account.username || account.id} (${account.platform})`);
    if (force) console.log(`  --force: will regenerate even if inputs unchanged`);

    await ghostQueue.add(JOB_GENERATE_VOICE_PROFILE, {
      connectedAccountId: userId,
      force,
    });

    console.log(`✅ Job queued`);
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await knex.destroy();
  }
}

main();
