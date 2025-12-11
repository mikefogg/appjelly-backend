/**
 * Grant or revoke manual subscription access to an account
 * Usage: npm run grant-access <account_id_or_email> <days> [reason]
 *        npm run grant-access <account_id_or_email> --revoke
 * Example: npm run grant-access abc123 365 "beta_tester"
 * Example: npm run grant-access user@example.com 365 "beta_tester"
 * Example: npm run grant-access user@example.com --revoke
 */

import { Subscription, Account } from "../src/models/index.js";

const identifier = process.argv[2];
const isRevoke = process.argv[3] === "--revoke";
const days = isRevoke ? 0 : (parseInt(process.argv[3]) || 365);
const reason = process.argv[4] || "manual_grant";

if (!identifier) {
  console.error("Usage: npm run grant-access <account_id_or_email> <days> [reason]");
  console.error("       npm run grant-access <account_id_or_email> --revoke");
  console.error("Example: npm run grant-access abc123 365 beta_tester");
  console.error("Example: npm run grant-access user@example.com 365 development");
  console.error("Example: npm run grant-access user@example.com --revoke");
  process.exit(1);
}

async function grantAccess() {
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

    if (isRevoke) {
      const result = await Subscription.revokeManualAccess(account.id, account.app_id);
      if (result === 0) {
        console.log(`No manual subscription found to revoke`);
      } else {
        console.log(`Revoked manual access for account ${account.id}`);
      }
    } else {
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      const subscription = await Subscription.grantManualAccess(
        account.id,
        account.app_id,
        expiresAt,
        reason
      );

      console.log(`Granted access to account ${account.id}`);
      console.log(`  Expires: ${expiresAt.toISOString()}`);
      console.log(`  Days: ${days}`);
      console.log(`  Reason: ${reason}`);
      console.log(`  Subscription ID: ${subscription.id}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

grantAccess();
