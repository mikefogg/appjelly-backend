import { raw } from "objection";
import { Account, Subscription, WebhookEvent } from "#src/models/index.js";
import { addDays, addYears } from "date-fns";

const RC_ANON = "$RCAnonymousID";

// Map RevenueCat store names to our platform enum values
const mapStoreToPlatform = (store) => {
  const storeMap = {
    app_store: "ios",
    play_store: "android",
    stripe: "web",
    amazon: "amazon",
  };
  return storeMap[store?.toLowerCase()] || "unknown";
};

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
  const { event, appId, webhookEventId } = data;
  const jobKey = "revenuecat-webhook";

  // Get the webhook event record if we have one
  let webhookEvent = null;
  if (webhookEventId) {
    webhookEvent = await WebhookEvent.query().findById(webhookEventId);
  }

  // Validate event type
  if (!ALLOWED_WEBHOOK_TYPES.includes(event.type)) {
    if (process.env.NODE_ENV === "development") {
      console.log(`[${jobKey}] Skipped processing event type: ${event.type}`);
    }
    // Mark as processed even if skipped
    if (webhookEvent) {
      await webhookEvent.markProcessed();
    }
    return Promise.resolve();
  }

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[${jobKey}] Processing ${event.type} for app_user_id: ${event.app_user_id} (app: ${appId})`
    );
  }

  try {
    // Handle user transfers between accounts
    if (event.type === "TRANSFER") {
      await handleTransfer(event, appId, jobKey);
    } else {
      // Process regular subscription events
      await processSubscriptionEvent(event, appId, jobKey);
    }

    // Mark webhook event as processed
    if (webhookEvent) {
      await webhookEvent.markProcessed();
    }

    return Promise.resolve();
  } catch (error) {
    console.error(`[${jobKey}] Error processing webhook:`, error);

    // Mark webhook event as failed
    if (webhookEvent) {
      await webhookEvent.markFailed(error.message);
    }

    throw error; // Re-throw to trigger job retry
  }
};

const handleTransfer = async (event, appId, jobKey) => {
  const fromAliases = event.transferred_from || [];
  const toAliases = event.transferred_to || [];

  // Filter to non-anonymous aliases
  const nonAnonFromAliases = fromAliases.filter((alias) => !alias.includes(RC_ANON));
  const nonAnonToAliases = toAliases.filter((alias) => !alias.includes(RC_ANON));

  if (nonAnonToAliases.length === 0) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[${jobKey}] Skipped transfer from ${nonAnonFromAliases[0]} - no recipient user ID`
      );
    }
    return Promise.resolve();
  }

  // Find the target account for the transfer (check both id and clerk_id)
  const toAccount = await Account.query()
    .where((builder) => {
      builder
        .whereIn("id", nonAnonToAliases)
        .orWhereIn("clerk_id", nonAnonToAliases);
    })
    .first();
  if (!toAccount) {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[${jobKey}] Skipped transfer - account not found for aliases: ${nonAnonToAliases.join(", ")}`
      );
    }
    return Promise.resolve();
  }

  // Try to transfer existing subscriptions from all aliases (from and to)
  const allAliases = [...fromAliases, ...toAliases];
  let query = Subscription.query().whereIn("rc_user_id", allAliases);
  if (appId) {
    query = query.where("app_id", appId);
  }

  // Use account's clerk_id or first non-anon alias as the canonical user id
  const toUserId = toAccount.clerk_id || nonAnonToAliases[0];
  const fromUserId = nonAnonFromAliases[0] || "unknown";

  const updatedSubs = await query.patch({
    rc_user_id: toUserId,
    account_id: toAccount.id,
    metadata: raw(
      `metadata || '{"transferred_at": "${new Date().toISOString()}", "transferred_from": "${fromUserId}"}'`
    ),
  });

  console.log(
    `[${jobKey}] Transferred ${updatedSubs} subscriptions to ${toUserId}`
  );

  // If no subscriptions were transferred, check if there's an active subscription for this product
  // and create it for the target account
  if (updatedSubs === 0 && event.product_id) {
    console.log(`[${jobKey}] No existing subscriptions found, creating from transfer event`);

    await Subscription.query().insert({
      account_id: toAccount.id,
      app_id: appId || null,
      rc_user_id: toUserId,
      rc_entitlement: event.entitlement_ids?.[0] || "pro_access",
      rc_product_id: event.product_id,
      rc_period_type: (event.period_type || "normal").toLowerCase(),
      rc_renewal_status: "active",
      rc_platform: mapStoreToPlatform(event.store),
      rc_expiration: event.expiration_at_ms
        ? addDays(new Date(event.expiration_at_ms), 1).toISOString()
        : addYears(new Date(), 100).toISOString(),
      metadata: {
        original_aliases: allAliases,
        entitlement_ids: event.entitlement_ids || [],
        created_from_transfer: true,
        transferred_from: fromUserId,
        webhook_event_type: event.type,
      },
    });

    console.log(`[${jobKey}] Created subscription for ${toUserId} from transfer`);
  }

  return Promise.resolve();
};

const processSubscriptionEvent = async (event, appId, jobKey) => {
  const originalAlias = event.original_app_user_id;
  const allAliases = event.aliases || [];
  const appUserId = event.app_user_id;

  // Filter to non-anonymous aliases for account lookup
  const nonAnonAliases = allAliases.filter((alias) => !alias.includes(RC_ANON));

  // Also include app_user_id if it's not anonymous
  if (appUserId && !appUserId.includes(RC_ANON) && !nonAnonAliases.includes(appUserId)) {
    nonAnonAliases.push(appUserId);
  }

  console.log(`[${jobKey}] Looking up account by aliases: ${nonAnonAliases.join(", ")}`);

  // Find account by any of the non-anonymous aliases (single query)
  // Check both id and clerk_id since apps may identify users by either
  let account = null;
  if (nonAnonAliases.length > 0) {
    account = await Account.query()
      .where((builder) => {
        builder
          .whereIn("id", nonAnonAliases)
          .orWhereIn("clerk_id", nonAnonAliases);
      })
      .first();
  }

  // Use the clerk_id we found, or fall back to first non-anon alias
  const userId = account?.clerk_id || nonAnonAliases[0] || appUserId;

  if (account) {
    console.log(`[${jobKey}] Found account ${account.id} for clerk_id ${account.clerk_id}`);
  } else {
    console.log(`[${jobKey}] No account found for aliases: ${nonAnonAliases.join(", ")}`);
  }

  // Find existing subscription (scoped to app if provided)
  const productId = event.product_id;
  let query = Subscription.query()
    .where((builder) => {
      if (event.aliases && event.aliases.length > 0) {
        builder.whereIn("rc_user_id", event.aliases);
      } else {
        builder.where("rc_user_id", originalAlias);
      }
    })
    .where("rc_product_id", productId)
    .where("rc_platform", mapStoreToPlatform(event.store));

  if (appId) {
    query = query.where("app_id", appId);
  }

  let subscription = await query.first();

  // Create new subscription if it doesn't exist
  if (!subscription) {
    subscription = await createNewSubscription(event, account, originalAlias, appId);

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

const createNewSubscription = async (event, account, originalAlias, appId) => {
  const subscriptionData = {
    account_id: account?.id || null,
    app_id: appId || null,
    rc_user_id: originalAlias,
    rc_entitlement: event.entitlement_ids?.[0] || "pro_access",
    rc_product_id: event.product_id,
    rc_period_type: (event.period_type || "normal").toLowerCase(),
    rc_renewal_status: "active",
    rc_platform: mapStoreToPlatform(event.store),
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
    rc_period_type: (event.period_type || subscription.rc_period_type || "normal").toLowerCase(),
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
