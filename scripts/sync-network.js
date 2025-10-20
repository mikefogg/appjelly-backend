/**
 * Manually trigger sync-network job for a connected account
 * Usage: npm run sync-network <connection_id>
 */

import { ghostQueue, JOB_SYNC_NETWORK } from "../src/background/queues/index.js";
import { ConnectedAccount } from "../src/models/index.js";

const connectionId = process.argv[2];

if (!connectionId) {
  console.error("❌ Error: Please provide a connection ID");
  console.log("Usage: npm run sync-network <connection_id>");
  process.exit(1);
}

async function syncNetwork() {
  try {
    console.log(`🔄 Triggering sync-network job for connection: ${connectionId}`);

    // Verify connection exists
    const connection = await ConnectedAccount.query().findById(connectionId);
    if (!connection) {
      console.error(`❌ Connection ${connectionId} not found`);
      process.exit(1);
    }

    console.log(`✅ Found connection: ${connection.username} (${connection.platform})`);

    // Add job to queue (use connection ID as job ID to prevent duplicates)
    const job = await ghostQueue.add(JOB_SYNC_NETWORK, {
      connectedAccountId: connectionId,
    }, {
      jobId: `sync-network-${connectionId}`,
    });

    console.log(`✅ Job queued successfully (ID: ${job.id})`);
    console.log(`📊 Monitor job status in the ghost worker logs`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

syncNetwork();
