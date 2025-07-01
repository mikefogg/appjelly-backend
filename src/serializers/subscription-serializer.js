export const subscriptionSerializer = (subscription) => {
  return {
    id: subscription.id,
    rc_entitlement: subscription.rc_entitlement,
    rc_product_id: subscription.rc_product_id,
    rc_period_type: subscription.rc_period_type,
    rc_renewal_status: subscription.rc_renewal_status,
    rc_platform: subscription.rc_platform,
    rc_expiration: subscription.rc_expiration,
    is_active: subscription.isActive(),
    is_expired: subscription.isExpired(),
    created_at: subscription.created_at,
    updated_at: subscription.updated_at,
  };
};

export const subscriptionStatusSerializer = (account) => {
  const activeSubscription = account.subscriptions?.find(sub => sub.isActive());
  
  return {
    has_active_subscription: !!activeSubscription,
    entitlement: activeSubscription ? activeSubscription.rc_entitlement : null,
    renewal_status: activeSubscription ? activeSubscription.rc_renewal_status : null,
    expires_at: activeSubscription ? activeSubscription.rc_expiration : null,
    subscription: activeSubscription ? subscriptionSerializer(activeSubscription) : null,
    entitlements: activeSubscription ? getEntitlements(activeSubscription) : getBasicEntitlements(),
  };
};

const getEntitlements = (subscription) => {
  const baseEntitlements = getBasicEntitlements();
  
  if (subscription.hasEntitlement("pro_access")) {
    return {
      ...baseEntitlements,
      unlimited_stories: true,
      premium_characters: true,
      advanced_sharing: true,
      max_actors: 10,
      max_stories_per_month: -1, // unlimited
    };
  }
  
  if (subscription.hasEntitlement("premium_access")) {
    return {
      ...baseEntitlements,
      unlimited_stories: true,
      premium_characters: true,
      advanced_sharing: true,
      priority_support: true,
      early_access: true,
      max_actors: -1, // unlimited
      max_stories_per_month: -1, // unlimited
    };
  }
  
  return baseEntitlements;
};

const getBasicEntitlements = () => {
  return {
    unlimited_stories: false,
    premium_characters: false,
    advanced_sharing: false,
    priority_support: false,
    early_access: false,
    max_actors: 3,
    max_stories_per_month: 5,
  };
};

export const paywallSerializer = (products) => {
  return {
    products: products.map(product => ({
      id: product.id,
      identifier: product.identifier,
      title: product.title,
      description: product.description,
      price: product.price,
      currency: product.currency,
      period: product.period,
      entitlements: product.entitlements,
      features: product.features,
    })),
    entitlements: {
      pro_access: {
        name: "Pro Access",
        features: ["Unlimited Stories", "Premium Characters", "Advanced Sharing"],
      },
      premium_access: {
        name: "Premium Access",
        features: ["Everything in Pro", "Priority Support", "Early Access"],
      },
    },
  };
};