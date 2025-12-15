import { FREEMIUM_CONFIG } from "#src/config/freemium.js";

export const accountSerializer = (account) => {
  return {
    id: account.id,
    clerk_id: account.clerk_id,
    email: account.email,
    app_id: account.app_id,
    name: account.name, // Account/family name (e.g. "Fogg")
    metadata: account.metadata,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
};

export const currentAccountSerializer = (account, options = {}) => {
  const baseData = accountSerializer(account);

  // Get subscription info using the account method (now synchronous)
  const subscriptionInfo = account.getSubscriptionInfo();
  const hasSubscription = subscriptionInfo.is_active;

  // Free tier info
  const connectionsUsed = options.connectionsCount ?? 0;
  const connectionsLimit = FREEMIUM_CONFIG.FREE_CONNECTIONS_LIMIT;

  return {
    ...baseData,
    display_name: account.metadata?.display_name || "My Family",
    timezone: account.timezone,
    generation_time: account.generation_time,
    generation_time_utc: account.generation_time_utc,
    notifications_enabled: account.notifications_enabled,
    notification_prompt_shown: account.notification_prompt_shown,
    app: account.app ? {
      id: account.app.id,
      slug: account.app.slug,
      name: account.app.name,
      config: account.app.config,
    } : null,
    subscription: subscriptionInfo,
    free_tier: {
      connections_used: connectionsUsed,
      connections_limit: connectionsLimit,
      at_connection_limit: !hasSubscription && connectionsUsed >= connectionsLimit,
    },
  };
};

export const publicAccountSerializer = (account) => {
  return {
    id: account.id,
    name: account.name, // Account/family name for display
    display_name: account.metadata?.display_name || "Family Member",
    metadata: {
      avatar: account.metadata?.avatar,
    },
    created_at: account.created_at,
  };
};