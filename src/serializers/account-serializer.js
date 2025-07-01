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

export const currentAccountSerializer = (account) => {
  const baseData = accountSerializer(account);
  
  // Get subscription info using the account method (now synchronous)
  const subscriptionInfo = account.getSubscriptionInfo();
  
  return {
    ...baseData,
    display_name: account.metadata?.display_name || "My Family",
    app: account.app ? {
      id: account.app.id,
      slug: account.app.slug,
      name: account.app.name,
      config: account.app.config,
    } : null,
    subscription: subscriptionInfo,
    stats: {
      actors_count: account.actors?.length || 0,
      artifacts_count: account.artifacts?.length || 0,
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