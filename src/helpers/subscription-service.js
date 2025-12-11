import { Subscription, Account } from "#src/models/index.js";

class SubscriptionService {
  constructor() {
    this.revenuecatApiKey = process.env.REVENUECAT_API_KEY;
    this.revenuecatProjectId = process.env.REVENUECAT_PROJECT_ID;
    this.revenuecatBaseUrl = "https://api.revenuecat.com/v2";
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
   * Get customer subscriptions from RevenueCat API v2
   * @param {string} customerId - The RC customer ID (app_user_id)
   * @param {string} environment - 'production' or 'sandbox'
   * @returns {Array} List of subscriptions
   */
  async getCustomerSubscriptions(customerId, environment = "production") {
    const response = await fetch(
      `${this.revenuecatBaseUrl}/projects/${this.revenuecatProjectId}/customers/${encodeURIComponent(customerId)}/subscriptions?environment=${environment}`,
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

    const data = await response.json();
    return data.items || [];
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
   * Fetches current subscriptions from RC and updates our database
   * Uses same lookup pattern as webhooks: rc_user_id + rc_product_id + rc_platform
   * @param {string} customerId - The RC customer ID (app_user_id)
   * @param {string} accountId - Our internal account ID
   * @param {string} appId - Our internal app ID
   * @returns {Object} Sync result
   */
  async syncSubscriptionStatus(customerId, accountId, appId) {
    console.log(`[SubscriptionSync] Syncing for customer: ${customerId}, account: ${accountId}, app: ${appId}`);

    // Fetch subscriptions from RevenueCat
    const subscriptions = await this.getCustomerSubscriptions(customerId);
    console.log(`[SubscriptionSync] Found ${subscriptions.length} subscriptions from RC`);
    console.log(`[SubscriptionSync] Raw RC response:`, JSON.stringify(subscriptions, null, 2));

    if (subscriptions.length === 0) {
      return { synced: 0, message: "No subscriptions found" };
    }

    let synced = 0;
    for (const rcSub of subscriptions) {
      console.log(`[SubscriptionSync] Processing subscription:`, {
        id: rcSub.id,
        product_id: rcSub.product_id,
        store: rcSub.store,
        gives_access: rcSub.gives_access,
        status: rcSub.status,
        original_customer_id: rcSub.original_customer_id,
      });

      // Only process subscriptions that give access
      if (!rcSub.gives_access) {
        console.log(`[SubscriptionSync] Skipping ${rcSub.id} - gives_access is false`);
        continue;
      }

      // Map RC status to our status
      const renewalStatus = this.mapRcStatus(rcSub.status, rcSub.auto_renewal_status);
      const platform = this.mapStoreToPlatform(rcSub.store);

      // Try to find existing subscription - first by RC subscription ID, then by other identifiers
      const rcSubId = rcSub.id;
      const originalCustomerId = rcSub.original_customer_id;

      console.log(`[SubscriptionSync] Looking for existing sub with:`, {
        rc_subscription_id: rcSubId,
        original_customer_id: originalCustomerId,
        customerId,
        product_id: rcSub.product_id,
        platform,
        app_id: appId,
      });

      // First try to find by RC subscription ID (most reliable)
      let existingSub = await Subscription.query()
        .whereRaw("metadata->>'rc_subscription_id' = ?", [rcSubId])
        .where("app_id", appId)
        .first();

      // If not found, try by original_customer_id + product + platform
      if (!existingSub && originalCustomerId) {
        existingSub = await Subscription.query()
          .where("rc_user_id", originalCustomerId)
          .where("rc_product_id", rcSub.product_id)
          .where("rc_platform", platform)
          .where("app_id", appId)
          .first();
      }

      // If still not found, try by the customerId we're syncing with
      if (!existingSub) {
        existingSub = await Subscription.query()
          .where("rc_user_id", customerId)
          .where("rc_product_id", rcSub.product_id)
          .where("rc_platform", platform)
          .where("app_id", appId)
          .first();
      }

      console.log(`[SubscriptionSync] Existing subscription found:`, existingSub?.id || "none");

      // For new subscriptions, use the customerId (clerk_id) as rc_user_id
      const rcUserId = existingSub?.rc_user_id || customerId;

      // Add 1 day buffer to expiration (matches webhook behavior)
      const expiration = rcSub.current_period_ends_at
        ? new Date(rcSub.current_period_ends_at + 86400000).toISOString() // +1 day in ms
        : new Date(Date.now() + 100 * 365 * 86400000).toISOString(); // 100 years for lifetime

      const subData = {
        account_id: accountId,
        app_id: appId,
        rc_user_id: rcUserId,
        rc_entitlement: rcSub.entitlements?.items?.[0]?.entitlement_id || "pro_access",
        rc_product_id: rcSub.product_id,
        rc_period_type: rcSub.status === "trialing" ? "trial" : "normal",
        rc_renewal_status: renewalStatus,
        rc_platform: platform,
        rc_expiration: expiration,
        metadata: existingSub ? {
          ...existingSub.metadata,
          rc_subscription_id: rcSub.id,
          auto_renewal_status: rcSub.auto_renewal_status,
          gives_access: rcSub.gives_access,
          last_sync_at: new Date().toISOString(),
        } : {
          original_aliases: [rcUserId],
          entitlement_ids: rcSub.entitlements?.items?.map(e => e.entitlement_id) || [],
          rc_subscription_id: rcSub.id,
          auto_renewal_status: rcSub.auto_renewal_status,
          gives_access: rcSub.gives_access,
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
        console.log(`[SubscriptionSync] Created new subscription ${newSub.id} for product ${rcSub.product_id}`);
      }

      synced++;
    }

    return { synced, total: subscriptions.length };
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