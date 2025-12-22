/**
 * Queue suggestion generation for a connected account
 *
 * Usage:
 *   node tasks/admin/queue-suggestions.js <connected_account_id>
 *   node tasks/admin/queue-suggestions.js <connected_account_id> --count=5
 *   node tasks/admin/queue-suggestions.js <connected_account_id> --skip-limits
 */

import { ConnectedAccount, knex } from "#src/models/index.js";
import {
  ghostQueue,
  JOB_GENERATE_SUGGESTIONS,
} from "#src/background/queues/index.js";

async function main() {
  try {
    const args = process.argv.slice(2);
    const userId = args.find(arg => !arg.startsWith("--"));
    const countArg = args.find(arg => arg.startsWith("--count="));
    const count = countArg ? parseInt(countArg.split("=")[1], 10) : 3;
    const skipLimits = args.includes("--skip-limits");

    if (!userId) {
      console.error("Usage: node tasks/admin/queue-suggestions.js <connected_account_id> [--count=N] [--skip-limits]");
      process.exit(1);
    }

    const account = await ConnectedAccount.query().findById(userId);
    if (!account) {
      console.error(`Connected account ${userId} not found`);
      process.exit(1);
    }

    console.log(`Queuing ${count} suggestions for ${account.username || account.id} (${account.platform})`);
    if (skipLimits) console.log(`--skip-limits: bypassing free user generation limits`);

    await ghostQueue.add(JOB_GENERATE_SUGGESTIONS, {
      connectedAccountId: userId,
      suggestionCount: count,
      reason: skipLimits ? "admin" : undefined,
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
