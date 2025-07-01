import { raw } from "objection";
import { Account, Subscription } from "#src/models/index.js";
import { addDays, addYears } from "date-fns";

const RC_ANON = "$RCAnonymousID";

const ALLOWED_WEBHOOK_TYPES = [
  "INITIAL_PURCHASE",
  "RENEWAL",
  "NON_RENEWING_PURCHASE",
  "TRANSFER",
  "PRODUCT_CHANGE",
  "BILLING_ISSUE",
  "CANCELLATION",
  "UNCANCELLATION",
  "SUBSCRIPTION_EXTENDED",
  "EXPIRATION",
];

const ProcessRevenueCatWebhookWorker = async ({ data }) => {
  const event = data.event;
  const jobKey = "revenuecat-webhook";

  // Validate event type
  if (!ALLOWED_WEBHOOK_TYPES.includes(event.type)) {
    if (process.env.NODE_ENV === "development") {
      console.log(`[${jobKey}] Skipped processing event type: ${event.type}`);
    }
    return Promise.resolve();
  }

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[${jobKey}] Processing ${event.type} for app_user_id: ${event.app_user_id}`
    );
  }

  try {
    // Handle user transfers between accounts
    if (event.type === "TRANSFER") {
      return await handleTransfer(event, jobKey);
    }

    // Process regular subscription events
    return await processSubscriptionEvent(event, jobKey);
  } catch (error) {
    console.error(`[${jobKey}] Error processing webhook:`, error);
    throw error; // Re-throw to trigger job retry
  }
};

const handleTransfer = async (event, jobKey) => {
  const fromAliases = event.transferred_from || [];
  const toAliases = event.transferred_to || [];

  // Find the actual user IDs (non-anonymous)
  const fromUserId = fromAliases.find((alias) => !alias.includes(RC_ANON));
  const toUserId = toAliases.find((alias) => !alias.includes(RC_ANON));

  if (!toUserId) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[${jobKey}] Skipped transfer from ${fromUserId} - no recipient user ID`
      );
    }
    return Promise.resolve();
  }

  // Find the target account for the transfer
  const toAccount = await Account.query().findOne({ clerk_id: toUserId });
  if (!toAccount) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[${jobKey}] Skipped transfer - account not found for user ${toUserId}`
      );
    }
    return Promise.resolve();
  }

  // Transfer subscriptions to the new account
  const updatedSubs = await Subscription.query()
    .whereIn("rc_user_id", fromAliases)
    .patch({
      rc_user_id: toAliases[0],
      account_id: toAccount.id,
      metadata: raw(
        `metadata || '{"transferred_at": "${new Date().toISOString()}", "transferred_from": "${fromUserId}"}'`
      ),
    });

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[${jobKey}] Transferred ${updatedSubs} subscriptions from ${fromUserId} to ${toUserId}`
    );
  }

  // Queue analytics update for both accounts
  if (fromUserId) {
    // await analyticsQueue.add(JOB_UPDATE_USER_ANALYTICS, {
    //   accountClerkId: fromUserId,
    //   event: "subscription_transferred_out",
    //   metadata: { to_user_id: toUserId },
    // });
  }

  // await analyticsQueue.add(JOB_UPDATE_USER_ANALYTICS, {
  //   accountClerkId: toUserId,
  //   event: "subscription_transferred_in",
  //   metadata: { from_user_id: fromUserId },
  // });

  return Promise.resolve();
};

const processSubscriptionEvent = async (event, jobKey) => {
  const originalAlias = event.original_app_user_id;
  const customIds =
    event.aliases?.filter((alias) => !alias.includes(RC_ANON)) || [];
  const appUserId = event.app_user_id;
  const userId = customIds.includes(appUserId) ? appUserId : customIds[0];

  // Find the account associated with this user
  let account = null;
  if (userId) {
    account = await Account.query().findOne({ clerk_id: userId });
  }

  if (!account && process.env.NODE_ENV === "development") {
    console.log(
      `[${jobKey}] No account found for user ${userId}, creating placeholder subscription`
    );
  }

  // Find existing subscription
  const productId = event.product_id;
  let subscription = await Subscription.query()
    .where((builder) => {
      if (event.aliases && event.aliases.length > 0) {
        builder.whereIn("rc_user_id", event.aliases);
      } else {
        builder.where("rc_user_id", originalAlias);
      }
    })
    .where("rc_product_id", productId)
    .where("rc_platform", event.store)
    .first();

  // Create new subscription if it doesn't exist
  if (!subscription) {
    subscription = await createNewSubscription(event, account, originalAlias);

    // Handle first-time purchase events
    if (event.type === "INITIAL_PURCHASE") {
      await handleInitialPurchase(event, account, subscription);
    }
  }

  // Update existing subscription
  await updateSubscription(subscription, event, account);

  // Handle specific event types
  await handleSpecificEventTypes(event, account, subscription, jobKey);

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[${jobKey}] Updated subscription ${subscription.id} for user ${
        account?.clerk_id || "unknown"
      }`
    );
  }
  return Promise.resolve();
};

const createNewSubscription = async (event, account, originalAlias) => {
  const subscriptionData = {
    account_id: account?.id || null,
    rc_user_id: originalAlias,
    rc_entitlement: event.entitlement_ids?.[0] || "pro_access",
    rc_product_id: event.product_id,
    rc_period_type: event.period_type || "normal",
    rc_renewal_status: "active",
    rc_platform: event.store,
    rc_expiration: event.expiration_at_ms
      ? addDays(new Date(event.expiration_at_ms), 1).toISOString()
      : addYears(new Date(), 100).toISOString(), // Lifetime for non-expiring products
    metadata: {
      original_aliases: event.aliases || [originalAlias],
      entitlement_ids: event.entitlement_ids || [],
      created_from_webhook: true,
      webhook_event_type: event.type,
    },
  };

  return await Subscription.query().insert(subscriptionData);
};

const updateSubscription = async (subscription, event, account) => {
  const updateData = {
    account_id: subscription.account_id || account?.id || null,
    rc_user_id: event.original_app_user_id,
    rc_period_type: event.period_type || subscription.rc_period_type,
    rc_expiration: event.expiration_at_ms
      ? addDays(new Date(event.expiration_at_ms), 1).toISOString()
      : addYears(new Date(), 100).toISOString(),
    metadata: {
      ...subscription.metadata,
      original_aliases:
        event.aliases || subscription.metadata?.original_aliases || [],
      entitlement_ids:
        event.entitlement_ids || subscription.metadata?.entitlement_ids || [],
      last_webhook_event: event.type,
      last_webhook_at: new Date().toISOString(),
    },
  };

  // Handle cancellation
  if (event.type === "CANCELLATION") {
    updateData.rc_renewal_status = "cancelled";
    updateData.metadata = {
      ...updateData.metadata,
      cancel_reason: event.cancel_reason,
      cancelled_at: new Date().toISOString(),
    };
  }

  // Handle uncancellation
  if (event.type === "UNCANCELLATION") {
    updateData.rc_renewal_status = "active";
    updateData.metadata = {
      ...updateData.metadata,
      cancel_reason: null,
      cancelled_at: null,
      uncancelled_at: new Date().toISOString(),
    };
  }

  // Handle product changes
  if (event.type === "PRODUCT_CHANGE") {
    updateData.rc_product_id = event.new_product_id || event.product_id;
    updateData.metadata = {
      ...updateData.metadata,
      previous_product_id: subscription.rc_product_id,
      product_changed_at: new Date().toISOString(),
    };
  }

  // Handle billing issues
  if (event.type === "BILLING_ISSUE") {
    updateData.rc_renewal_status = "billing_issue";
    updateData.metadata = {
      ...updateData.metadata,
      billing_issue_detected_at: new Date().toISOString(),
    };
  }

  // Handle expiration
  if (event.type === "EXPIRATION") {
    updateData.rc_renewal_status = "expired";
    updateData.metadata = {
      ...updateData.metadata,
      expired_at: new Date().toISOString(),
    };
  }

  await subscription.$query().patch(updateData);
  return subscription;
};

const handleInitialPurchase = async (event, account, subscription) => {
  if (!account) return;

  // Send welcome email for trial purchases
  if (event.period_type?.toLowerCase() === "trial" && event.expiration_at_ms) {
    // TODO: Send welcome email for trial purchases
  }
};

const handleSpecificEventTypes = async (
  event,
  account,
  subscription,
  jobKey
) => {
  if (!account) return;

  switch (event.type) {
    case "RENEWAL":
      // Send renewal confirmation
      // await notificationQueue.add(JOB_SEND_PUSH_NOTIFICATION, {
      //   accountId: account.id,
      //   title: "Subscription Renewed",
      //   body: "Your pro subscription has been renewed successfully!",
      //   data: {
      //     type: "subscription_renewed",
      //     subscription_id: subscription.id,
      //   },
      // });
      break;

    case "CANCELLATION":
      // Send cancellation confirmation and retention offer
      // await notificationQueue.add(JOB_SEND_PUSH_NOTIFICATION, {
      //   accountId: account.id,
      //   title: "Subscription Cancelled",
      //   body: "Your subscription has been cancelled but remains active until expiration.",
      //   data: {
      //     type: "subscription_cancelled",
      //     subscription_id: subscription.id,
      //     expires_at: subscription.rc_expiration,
      //   },
      // });
      break;

    case "BILLING_ISSUE":
      // Send billing issue notification
      // await notificationQueue.add(JOB_SEND_PUSH_NOTIFICATION, {
      //   accountId: account.id,
      //   title: "Billing Issue",
      //   body: "There's an issue with your payment method. Please update it to continue your subscription.",
      //   data: {
      //     type: "billing_issue",
      //     subscription_id: subscription.id,
      //   },
      // });
      break;

    case "EXPIRATION":
      // Send expiration notification
      // await notificationQueue.add(JOB_SEND_PUSH_NOTIFICATION, {
      //   accountId: account.id,
      //   title: "Subscription Expired",
      //   body: "Your pro subscription has expired. Resubscribe to continue enjoying unlimited stories!",
      //   data: {
      //     type: "subscription_expired",
      //     subscription_id: subscription.id,
      //   },
      // });
      break;
  }

  // // Queue analytics update for all events
  // await analyticsQueue.add(JOB_UPDATE_USER_ANALYTICS, {
  //   accountId: account.id,
  //   event: `subscription_${event.type.toLowerCase()}`,
  //   metadata: {
  //     subscription_id: subscription.id,
  //     product_id: event.product_id,
  //     store: event.store,
  //     period_type: event.period_type,
  //   },
  // });
};

export default ProcessRevenueCatWebhookWorker;
