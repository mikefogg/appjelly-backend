import { Subscription, Account } from "#src/models/index.js";

class SubscriptionService {
  constructor() {
    this.revenuecatApiKey = process.env.REVENUECAT_API_KEY;
    this.revenuecatApiKeyV1 = process.env.REVENUECAT_API_KEY_V1;
    this.revenuecatProjectId = process.env.REVENUECAT_PROJECT_ID;
    this.revenuecatBaseUrl = "https://api.revenuecat.com/v2";
    this.revenuecatBaseUrlV1 = "https://api.revenuecat.com/v1";
  }

  async processRevenueCatWebhook(webhookData) {
    try {
      const { event } = webhookData;
      const app_user_id = event?.app_user_id;
      
      if (!app_user_id) {
        throw new Error("Missing app_user_id in webhook");
      }

      switch (event.type) {
        case "INITIAL_PURCHASE":
        case "RENEWAL":
        case "PRODUCT_CHANGE":
          return await this.handleSubscriptionActivation(webhookData);
        
        case "CANCELLATION":
        case "EXPIRATION":
          return await this.handleSubscriptionDeactivation(webhookData);
        
        case "BILLING_ISSUE":
          return await this.handleBillingIssue(webhookData);
        
        case "SUBSCRIBER_ALIAS":
          return await this.handleSubscriberAlias(webhookData);

        case "TRANSFER":
          return await this.handleTransfer(webhookData);

        default:
          console.log(`Unhandled webhook event type: ${event.type}`);
          return { success: true, message: "Event logged but not processed" };
      }
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("RevenueCat webhook processing error:", error);
      }
      throw error;
    }
  }

  async handleSubscriptionActivation(webhookData) {
    const { event } = webhookData;
    const app_user_id = event?.app_user_id;
    const productInfo = event.product_id ? this.getProductInfo(event.product_id) : {};

    const account = await Account.query()
      .where("clerk_id", app_user_id)
      .first();

    if (!account) {
      console.warn(`Account not found for clerk_id: ${app_user_id}`);
      return { success: false, message: "Account not found" };
    }

    const subscriptionData = {
      account_id: account.id,
      rc_user_id: app_user_id,
      rc_entitlement: event.entitlement_ids?.[0] || productInfo.entitlement,
      rc_product_id: event.product_id,
      rc_period_type: (event.period_type || "normal").toLowerCase(),
      rc_renewal_status: "active",
      rc_platform: this.detectPlatform(webhookData),
      rc_expiration: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
      metadata: {
        webhook_event: event.type,
        original_app_user_id: event.original_app_user_id,
        price: event.price,
        currency: event.currency,
        processed_at: new Date().toISOString(),
        raw_webhook: webhookData,
      },
    };

    // Prepare data in the format expected by Subscription.updateFromWebhook
    const webhookDataForModel = {
      product_id: event.product_id,
      entitlement: event.entitlement_ids?.[0],
      period_type: (event.period_type || "normal").toLowerCase(),
      renewal_status: "active",
      platform: this.detectPlatform(webhookData),
      expiration_date: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
      account_id: account.id,
    };
    
    await Subscription.updateFromWebhook(app_user_id, webhookDataForModel);

    return {
      success: true,
      message: "Subscription activated",
      subscription: subscriptionData,
    };
  }

  async handleSubscriptionDeactivation(webhookData) {
    const { event } = webhookData;
    const app_user_id = event?.app_user_id;

    const subscription = await Subscription.query()
      .where("rc_user_id", app_user_id)
      .where("rc_product_id", event.product_id)
      .first();

    if (!subscription) {
      console.warn(`Subscription not found for user: ${app_user_id}`);
      return { success: false, message: "Subscription not found" };
    }

    const updateData = {
      rc_renewal_status: event.type === "CANCELLATION" ? "cancelled" : "expired",
      rc_expiration: event.expiration_date,
      metadata: {
        ...subscription.metadata,
        cancellation_reason: event.cancellation_reason,
        cancelled_at: event.type === "CANCELLATION" ? new Date().toISOString() : null,
        expired_at: event.type === "EXPIRATION" ? new Date().toISOString() : null,
        processed_at: new Date().toISOString(),
      },
    };

    await subscription.$query().update(updateData);

    return {
      success: true,
      message: "Subscription deactivated",
      subscription: updateData,
    };
  }

  async handleBillingIssue(webhookData) {
    const { event } = webhookData;
    const app_user_id = event?.app_user_id;

    const subscription = await Subscription.query()
      .where("rc_user_id", app_user_id)
      .where("rc_product_id", event.product_id)
      .first();

    if (!subscription) {
      return { success: false, message: "Subscription not found" };
    }

    const updateData = {
      rc_renewal_status: "billing_issue",
      metadata: {
        ...subscription.metadata,
        billing_issue_detected_at: new Date().toISOString(),
        grace_period_expires_date: event.grace_period_expires_date,
        processed_at: new Date().toISOString(),
      },
    };

    await subscription.$query().update(updateData);

    return {
      success: true,
      message: "Billing issue recorded",
      subscription: updateData,
    };
  }

  async handleSubscriberAlias(webhookData) {
    const { event } = webhookData;
    const app_user_id = event?.app_user_id;
    const { alias_app_user_id } = event;

    await Subscription.query()
      .where("rc_user_id", alias_app_user_id)
      .update({ rc_user_id: app_user_id });

    return {
      success: true,
      message: "Subscriber alias updated",
      old_user_id: alias_app_user_id,
      new_user_id: app_user_id,
    };
  }

  async handleTransfer(webhookData) {
    const { event } = webhookData;
    const RC_ANON = "$RCAnonymousID";
    const fromAliases = event.transferred_from || [];
    const toAliases = event.transferred_to || [];

    // Find non-anonymous user IDs
    const fromUserId = fromAliases.find((alias) => !alias.includes(RC_ANON));
    const toUserId = toAliases.find((alias) => !alias.includes(RC_ANON));

    if (!toUserId) {
      console.warn(`[Transfer] No recipient user ID in transferred_to aliases`);
      return { success: false, message: "No recipient user ID" };
    }

    // Find target account
    const toAccount = await Account.query().findOne({ clerk_id: toUserId });
    if (!toAccount) {
      console.warn(`[Transfer] Account not found for clerk_id: ${toUserId}`);
      return { success: false, message: "Account not found" };
    }

    // Transfer existing subscriptions from all aliases
    const allAliases = [...fromAliases, ...toAliases];
    const updatedCount = await Subscription.query()
      .whereIn("rc_user_id", allAliases)
      .patch({
        rc_user_id: toUserId,
        account_id: toAccount.id,
      });

    console.log(`[Transfer] Transferred ${updatedCount} subscriptions to ${toUserId}`);

    // If no subscriptions found to transfer, create one from the event data
    if (updatedCount === 0 && event.product_id) {
      console.log(`[Transfer] Creating subscription from transfer event for ${toUserId}`);

      await Subscription.query().insert({
        account_id: toAccount.id,
        rc_user_id: toUserId,
        rc_entitlement: event.entitlement_ids?.[0] || "pro_access",
        rc_product_id: event.product_id,
        rc_period_type: (event.period_type || "normal").toLowerCase(),
        rc_renewal_status: "active",
        rc_platform: this.detectPlatform(webhookData),
        rc_expiration: event.expiration_at_ms
          ? new Date(event.expiration_at_ms + 86400000).toISOString() // +1 day
          : new Date(Date.now() + 100 * 365 * 86400000).toISOString(), // 100 years
        metadata: {
          original_aliases: allAliases,
          entitlement_ids: event.entitlement_ids || [],
          created_from_transfer: true,
          transferred_from: fromUserId,
          processed_at: new Date().toISOString(),
        },
      });
    }

    return {
      success: true,
      message: updatedCount > 0 ? "Subscriptions transferred" : "Subscription created from transfer",
      transferred_count: updatedCount,
      to_user_id: toUserId,
    };
  }

  detectPlatform(webhookData) {
    const store = webhookData.event?.store?.toLowerCase();

    if (store === "app_store") return "ios";
    if (store === "play_store") return "android";
    if (store === "stripe") return "web";
    if (store === "amazon") return "amazon";

    return "unknown";
  }

  getProductInfo(productId) {
    const productMap = {
      "pro_monthly": {
        entitlement: "pro_access",
        features: ["unlimited_stories", "premium_characters", "advanced_sharing"],
      },
      "pro_yearly": {
        entitlement: "pro_access",
        features: ["unlimited_stories", "premium_characters", "advanced_sharing"],
      },
      "premium_monthly": {
        entitlement: "premium_access",
        features: ["unlimited_everything", "priority_support", "early_access"],
      },
    };

    return productMap[productId] || { entitlement: "basic_access", features: [] };
  }

  /**
   * Get customer info from RevenueCat API v2
   * @param {string} customerId - The RC customer ID (app_user_id)
   * @returns {Object} Customer object with active_entitlements
   */
  async getCustomer(customerId) {
    const response = await fetch(
      `${this.revenuecatBaseUrl}/projects/${this.revenuecatProjectId}/customers/${encodeURIComponent(customerId)}`,
      {
        headers: {
          "Authorization": `Bearer ${this.revenuecatApiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`RevenueCat API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Get subscriber info from RevenueCat API v1
   * Works with aliases and returns all subscription data for App Store/Play Store
   * @param {string} appUserId - The RC app_user_id (can be an alias)
   * @returns {Object} Subscriber object with subscriptions and entitlements
   */
  async getSubscriberV1(appUserId) {
    const response = await fetch(
      `${this.revenuecatBaseUrlV1}/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: {
          "Authorization": `Bearer ${this.revenuecatApiKeyV1}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`RevenueCat V1 API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Map RevenueCat store to our platform enum
   */
  mapStoreToPlatform(store) {
    const storeMap = {
      app_store: "ios",
      play_store: "android",
      stripe: "web",
      amazon: "amazon",
    };
    return storeMap[store?.toLowerCase()] || "unknown";
  }

  /**
   * Sync subscription status from RevenueCat for a customer
   * Uses V1 API which works with aliases and returns App Store/Play Store subscriptions
   * @param {string} customerId - The RC customer ID (app_user_id or alias)
   * @param {string} accountId - Our internal account ID (optional - will look up by aliases if not provided)
   * @param {string} appId - Our internal app ID
   * @returns {Object} Sync result
   */
  async syncSubscriptionStatus(customerId, accountId, appId) {
    console.log(`[SubscriptionSync] Syncing for customer: ${customerId}, account: ${accountId}, app: ${appId}`);

    // Use V1 API which works with aliases and returns all subscription types
    const subscriberData = await this.getSubscriberV1(customerId);
    console.log(`[SubscriptionSync] V1 subscriber data:`, JSON.stringify(subscriberData, null, 2));

    const subscriber = subscriberData.subscriber;
    if (!subscriber) {
      return { synced: 0, message: "No subscriber data returned" };
    }

    // V1 response structure:
    // subscriber.subscriptions: { "product_id": { expires_date, purchase_date, store, ... } }
    // subscriber.entitlements: { "entitlement_id": { expires_date, product_identifier, ... } }
    const subscriptions = subscriber.subscriptions || {};
    const entitlements = subscriber.entitlements || {};
    const originalAppUserId = subscriber.original_app_user_id;

    // Build list of possible aliases to look up account
    // Include: customerId we queried with, original_app_user_id, and filter out anonymous IDs for account lookup
    const allAliases = [customerId, originalAppUserId].filter(Boolean);
    const nonAnonAliases = allAliases.filter(id => !id.startsWith("$RCAnonymousID:"));

    console.log(`[SubscriptionSync] Looking up account by aliases: ${nonAnonAliases.join(", ")}`);

    // If accountId not provided, look up by any of the aliases
    let resolvedAccountId = accountId;
    if (!resolvedAccountId && nonAnonAliases.length > 0) {
      const account = await Account.query()
        .whereIn("clerk_id", nonAnonAliases)
        .first();

      if (account) {
        resolvedAccountId = account.id;
        console.log(`[SubscriptionSync] Found account ${resolvedAccountId} by clerk_id`);
      }
    }

    if (!resolvedAccountId) {
      console.warn(`[SubscriptionSync] No account found for aliases: ${nonAnonAliases.join(", ")}`);
      return { synced: 0, message: "No account found for any alias" };
    }

    const productIds = Object.keys(subscriptions);
    console.log(`[SubscriptionSync] Found ${productIds.length} subscriptions: ${productIds.join(", ")}`);

    if (productIds.length === 0) {
      return { synced: 0, message: "No subscriptions found" };
    }

    let synced = 0;
    for (const productId of productIds) {
      const rcSub = subscriptions[productId];

      console.log(`[SubscriptionSync] Processing subscription:`, {
        product_id: productId,
        store: rcSub.store,
        expires_date: rcSub.expires_date,
        unsubscribe_detected_at: rcSub.unsubscribe_detected_at,
        billing_issues_detected_at: rcSub.billing_issues_detected_at,
      });

      // Check if subscription is expired
      const expiresDate = rcSub.expires_date ? new Date(rcSub.expires_date) : null;
      const isExpired = expiresDate && expiresDate < new Date();

      if (isExpired) {
        console.log(`[SubscriptionSync] Skipping ${productId} - expired on ${rcSub.expires_date}`);
        continue;
      }

      // Map store to platform
      const platform = this.mapStoreToPlatform(rcSub.store);

      // Determine renewal status
      let renewalStatus = "active";
      if (rcSub.billing_issues_detected_at) {
        renewalStatus = "billing_issue";
      } else if (rcSub.unsubscribe_detected_at) {
        renewalStatus = "cancelled";
      }

      // Find entitlement for this product
      const entitlementId = Object.keys(entitlements).find(
        (eid) => entitlements[eid].product_identifier === productId
      ) || "pro_access";

      console.log(`[SubscriptionSync] Looking for existing sub with product: ${productId}, platform: ${platform}`);

      // Try to find existing subscription
      let existingSub = await Subscription.query()
        .where("rc_product_id", productId)
        .where("rc_platform", platform)
        .where("app_id", appId)
        .first();

      // Also try by rc_user_id
      if (!existingSub) {
        existingSub = await Subscription.query()
          .where("rc_user_id", customerId)
          .where("rc_product_id", productId)
          .where("app_id", appId)
          .first();
      }

      // Try by original_app_user_id
      if (!existingSub && originalAppUserId) {
        existingSub = await Subscription.query()
          .where("rc_user_id", originalAppUserId)
          .where("rc_product_id", productId)
          .where("app_id", appId)
          .first();
      }

      console.log(`[SubscriptionSync] Existing subscription found:`, existingSub?.id || "none");

      // Use customerId (clerk_id) for new subscriptions
      const rcUserId = existingSub?.rc_user_id || customerId;

      // Add 1 day buffer to expiration
      const expiration = expiresDate
        ? new Date(expiresDate.getTime() + 86400000).toISOString()
        : new Date(Date.now() + 100 * 365 * 86400000).toISOString();

      const subData = {
        account_id: resolvedAccountId,
        app_id: appId,
        rc_user_id: rcUserId,
        rc_entitlement: entitlementId,
        rc_product_id: productId,
        rc_period_type: rcSub.period_type?.toLowerCase() || "normal",
        rc_renewal_status: renewalStatus,
        rc_platform: platform,
        rc_expiration: expiration,
        metadata: existingSub ? {
          ...existingSub.metadata,
          original_app_user_id: originalAppUserId,
          unsubscribe_detected_at: rcSub.unsubscribe_detected_at,
          billing_issues_detected_at: rcSub.billing_issues_detected_at,
          last_sync_at: new Date().toISOString(),
        } : {
          original_aliases: [rcUserId, originalAppUserId].filter(Boolean),
          original_app_user_id: originalAppUserId,
          entitlement_id: entitlementId,
          purchase_date: rcSub.purchase_date,
          created_from_sync: true,
          synced_at: new Date().toISOString(),
        },
      };

      console.log(`[SubscriptionSync] Subscription data to insert/update:`, subData);

      if (existingSub) {
        await existingSub.$query().patch(subData);
        console.log(`[SubscriptionSync] Updated subscription ${existingSub.id}`);
      } else {
        const newSub = await Subscription.query().insert(subData);
        console.log(`[SubscriptionSync] Created new subscription ${newSub.id} for product ${productId}`);
      }

      synced++;
    }

    return { synced, total: productIds.length };
  }

  /**
   * Map RC subscription status to our renewal status
   */
  mapRcStatus(status, autoRenewalStatus) {
    if (status === "expired") return "expired";
    if (status === "in_billing_retry" || status === "in_grace_period") return "billing_issue";
    if (status === "paused") return "paused";
    if (autoRenewalStatus === "will_not_renew") return "cancelled";
    return "active";
  }

  async checkEntitlement(account, entitlementName) {
    const activeSubscription = await Subscription.findActiveByAccount(account.id);
    
    if (!activeSubscription) {
      return { hasAccess: false, reason: "No active subscription" };
    }

    if (!activeSubscription.hasEntitlement(entitlementName)) {
      return { hasAccess: false, reason: "Entitlement not included in current subscription" };
    }

    return {
      hasAccess: true,
      reason: "active_subscription",
      subscription: activeSubscription,
      expiresAt: activeSubscription.rc_expiration,
    };
  }

  async logPaywallInteraction(accountId, action, metadata = {}) {
    try {
      const logData = {
        account_id: accountId,
        action,
        timestamp: new Date().toISOString(),
        metadata,
      };

      
      return { success: true };
    } catch (error) {
      console.error("Failed to log paywall interaction:", error);
      return { success: false, error: error.message };
    }
  }
}

export default new SubscriptionService();