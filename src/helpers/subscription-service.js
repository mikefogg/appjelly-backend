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
      rc_period_type: event.period_type || "normal",
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
      period_type: event.period_type || "normal",
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

  detectPlatform(webhookData) {
    const store = webhookData.event?.store;
    const userAgent = webhookData.api_version;

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
   * Sync subscription status from RevenueCat for a customer
   * Fetches current subscriptions from RC and updates our database
   * Uses same lookup pattern as webhooks: rc_user_id + rc_product_id + rc_platform
   * @param {string} customerId - The RC customer ID (app_user_id)
   * @param {string} accountId - Our internal account ID
   * @param {string} appId - Our internal app ID
   * @returns {Object} Sync result
   */
  async syncSubscriptionStatus(customerId, accountId, appId) {
    console.log(`[SubscriptionSync] Syncing for customer: ${customerId}`);

    // Fetch subscriptions from RevenueCat
    const subscriptions = await this.getCustomerSubscriptions(customerId);
    console.log(`[SubscriptionSync] Found ${subscriptions.length} subscriptions from RC`);

    if (subscriptions.length === 0) {
      return { synced: 0, message: "No subscriptions found" };
    }

    let synced = 0;
    for (const rcSub of subscriptions) {
      // Only process subscriptions that give access
      if (!rcSub.gives_access) {
        console.log(`[SubscriptionSync] Skipping ${rcSub.id} - no access`);
        continue;
      }

      // Map RC status to our status
      const renewalStatus = this.mapRcStatus(rcSub.status, rcSub.auto_renewal_status);

      // Use original_customer_id as rc_user_id (matches webhook's original_app_user_id)
      const rcUserId = rcSub.original_customer_id || customerId;

      // Find existing subscription using same pattern as webhooks:
      // rc_user_id + rc_product_id + rc_platform (store)
      const existingSub = await Subscription.query()
        .where("rc_user_id", rcUserId)
        .where("rc_product_id", rcSub.product_id)
        .where("rc_platform", rcSub.store)
        .where("app_id", appId)
        .first();

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
        rc_platform: rcSub.store,
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

      if (existingSub) {
        await existingSub.$query().patch(subData);
        console.log(`[SubscriptionSync] Updated subscription ${existingSub.id}`);
      } else {
        await Subscription.query().insert(subData);
        console.log(`[SubscriptionSync] Created new subscription for product ${rcSub.product_id}`);
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