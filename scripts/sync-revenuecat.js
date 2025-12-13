/**
 * Sync RevenueCat subscription status for an account
 * Usage: npm run sync-revenuecat <account_id_or_email>
 * Example: npm run sync-revenuecat user@example.com
 * Example: npm run sync-revenuecat abc123-uuid
 */

import { Account } from "../src/models/index.js";
import SubscriptionService from "../src/helpers/subscription-service.js";

const identifier = process.argv[2];

if (!identifier) {
  console.error("Usage: npm run sync-revenuecat <account_id_or_email>");
  console.error("Example: npm run sync-revenuecat user@example.com");
  console.error("Example: npm run sync-revenuecat abc123-uuid");
  process.exit(1);
}

async function syncRevenuecat() {
  try {
    // Find account by ID or email (case insensitive)
    let account;
    if (identifier.includes("@")) {
      account = await Account.query()
        .whereRaw("LOWER(email) = LOWER(?)", [identifier])
        .first();
    } else {
      account = await Account.query().findById(identifier);
    }

    if (!account) {
      console.error(`Account not found: ${identifier}`);
      process.exit(1);
    }

    console.log(`Found account: ${account.email || account.id}`);
    console.log(`  Account ID: ${account.id}`);
    console.log(`  Clerk ID: ${account.clerk_id}`);
    console.log(`  App ID: ${account.app_id}`);

    console.log(`\nSyncing subscription status from RevenueCat...`);

    // Try account UUID first (more likely to be in RevenueCat), then clerk_id
    const idsToTry = [account.id, account.clerk_id].filter(Boolean);
    let result = { synced: 0 };

    for (const customerId of idsToTry) {
      console.log(`\nTrying RevenueCat customer ID: ${customerId}`);
      try {
        result = await SubscriptionService.syncSubscriptionStatus(
          customerId,
          account.id,
          account.app_id
        );
        if (result.synced > 0) {
          console.log(`Found subscriptions with ID: ${customerId}`);
          break;
        }
      } catch (error) {
        console.log(`  No subscriber found with ID: ${customerId}`);
      }
    }

    console.log(`\nSync completed:`);
    console.log(`  Synced: ${result.synced}`);
    if (result.total !== undefined) {
      console.log(`  Total found: ${result.total}`);
    }
    if (result.message) {
      console.log(`  Message: ${result.message}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

syncRevenuecat();
