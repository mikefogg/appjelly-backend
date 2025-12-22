/**
 * Queue voice profile regeneration for a connected account
 *
 * Usage:
 *   node tasks/admin/queue-voice-regen.js <connected_account_id>
 *   node tasks/admin/queue-voice-regen.js <connected_account_id> --force
 *   node tasks/admin/queue-voice-regen.js --all
 *   node tasks/admin/queue-voice-regen.js --all --force
 */

import { ConnectedAccount, VoiceProfile, knex } from "#src/models/index.js";
import {
  ghostQueue,
  JOB_GENERATE_VOICE_PROFILE,
} from "#src/background/queues/index.js";

async function queueOne(userId, force) {
  const account = await ConnectedAccount.query().findById(userId);
  if (!account) {
    console.error(`Connected account ${userId} not found`);
    return false;
  }

  console.log(`Queuing voice regeneration for ${account.username || account.id} (${account.platform})`);

  await ghostQueue.add(JOB_GENERATE_VOICE_PROFILE, {
    connectedAccountId: userId,
    force,
  });

  return true;
}

async function queueAll(force) {
  // Find all active connections with a voice profile
  const accounts = await ConnectedAccount.query()
    .whereExists(
      VoiceProfile.query()
        .whereColumn("voice_profiles.connected_account_id", "connected_accounts.id")
        .where("status", "active")
    )
    .where("is_active", true);

  console.log(`Found ${accounts.length} accounts with voice profiles\n`);

  let queued = 0;
  for (const account of accounts) {
    console.log(`  ${account.username || account.id} (${account.platform})`);
    await ghostQueue.add(JOB_GENERATE_VOICE_PROFILE, {
      connectedAccountId: account.id,
      force,
    });
    queued++;
  }

  console.log(`\n✅ Queued ${queued} jobs`);
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const userId = args.find(arg => !arg.startsWith("--"));
    const force = args.includes("--force");
    const all = args.includes("--all");

    if (!userId && !all) {
      console.error("Usage:");
      console.error("  node tasks/admin/queue-voice-regen.js <connected_account_id> [--force]");
      console.error("  node tasks/admin/queue-voice-regen.js --all [--force]");
      process.exit(1);
    }

    if (force) console.log(`--force: will regenerate even if inputs unchanged\n`);

    if (all) {
      await queueAll(force);
    } else {
      const success = await queueOne(userId, force);
      if (success) console.log(`✅ Job queued`);
    }
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await knex.destroy();
  }
}

main();
