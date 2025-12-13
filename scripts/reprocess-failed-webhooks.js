/**
 * Reprocess failed webhook events
 * Usage: npm run reprocess-webhooks [source] [limit]
 * Example: npm run reprocess-webhooks revenuecat 100
 * Example: npm run reprocess-webhooks (processes all sources, default limit 100)
 */

import { WebhookEvent } from "../src/models/index.js";
import {
  subscriptionQueue,
  JOB_PROCESS_REVENUECAT_WEBHOOK,
} from "../src/background/queues/index.js";

const source = process.argv[2] || null;
const limit = parseInt(process.argv[3], 10) || 100;

async function reprocessFailedWebhooks() {
  try {
    // Build query for failed webhook events
    let query = WebhookEvent.query()
      .where("status", "failed")
      .orderBy("created_at", "asc")
      .limit(limit);

    if (source) {
      query = query.where("source", source);
    }

    const failedEvents = await query;

    if (failedEvents.length === 0) {
      console.log("No failed webhook events found.");
      process.exit(0);
    }

    console.log(`Found ${failedEvents.length} failed webhook event(s) to reprocess.\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const event of failedEvents) {
      try {
        console.log(`Processing: ${event.id}`);
        console.log(`  Source: ${event.source}`);
        console.log(`  Type: ${event.event_type}`);
        console.log(`  Error: ${event.error_message}`);
        console.log(`  Retry count: ${event.retry_count}`);

        // Requeue based on source
        if (event.source === "revenuecat") {
          await subscriptionQueue.add(
            JOB_PROCESS_REVENUECAT_WEBHOOK,
            {
              event: event.payload.event,
              appId: event.app_id,
              webhookEventId: event.id,
            },
            {
              priority: 1, // High priority for retries
            }
          );
        } else {
          console.log(`  Skipped: Unknown source "${event.source}"`);
          continue;
        }

        // Reset status to received for reprocessing
        await event.$query().patch({
          status: "received",
          error_message: null,
        });

        console.log(`  ✓ Requeued successfully\n`);
        successCount++;
      } catch (error) {
        console.error(`  ✗ Failed to requeue: ${error.message}\n`);
        errorCount++;
      }
    }

    console.log(`\nReprocessing complete:`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Errors: ${errorCount}`);

    process.exit(errorCount > 0 ? 1 : 0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

reprocessFailedWebhooks();
