export const appSerializer = (app) => {
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    config: app.config,
    created_at: app.created_at,
    updated_at: app.updated_at,
  };
};

export const appListSerializer = (apps) => {
  return {
    data: apps.map(appSerializer),
    meta: {
      total: apps.length,
    },
  };
};

export const appConfigSerializer = (app) => {
  // Filter out sensitive internal config
  const { internal, ...publicConfig } = app.config || {};
  
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    config: {
      features: publicConfig.features || [],
      branding: publicConfig.branding || {},
      content_limits: publicConfig.content_limits || {},
      ui: publicConfig.ui || {},
      limits: publicConfig.limits || {},
      ai: {
        provider: publicConfig.ai?.provider || "openai",
        model: publicConfig.ai?.model || "gpt-4",
        storyLength: publicConfig.ai?.storyLength || "medium",
      },
    },
  };
};