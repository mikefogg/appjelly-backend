import { faker } from "@faker-js/faker";
import { 
  App, 
  Account, 
  Actor, 
  Artifact, 
  ArtifactPage,
  Input, 
  Media, 
  Subscription,
  AccountLink,
  SharedView 
} from "#src/models/index.js";

export const createApp = async (overrides = {}) => {
  const timestamp = Date.now();
  const uniqueSlug = overrides.slug || `test-app-${timestamp}-${faker.string.alphanumeric(6)}`;
  return await App.query().insert({
    slug: uniqueSlug,
    name: overrides.name || "Test App",
    config: {
      features: ["stories", "sharing"],
      content_safety: {
        guidelines_updated: "2024-01-01"
      },
      ...overrides.config
    },
  });
};

export const createAccount = async (app, overrides = {}) => {
  return await Account.query().insert({
    clerk_id: overrides.clerk_id || `clerk_${faker.string.alphanumeric(10)}`,
    email: overrides.email || faker.internet.email(),
    app_id: app.id,
    metadata: {
      onboarding_completed: false,
      ...overrides.metadata
    },
  });
};

export const createActor = async (account, overrides = {}) => {
  return await Actor.query().insert({
    account_id: account.id,
    app_id: account.app_id,
    name: overrides.name || faker.person.firstName(),
    type: overrides.type || "child",
    is_claimable: overrides.is_claimable || false,
    metadata: {
      age: 8,
      traits: ["curious", "adventurous"],
      ...overrides.metadata
    },
    ...overrides // Allow any other field overrides
  });
};

export const createInput = async (account, actors = [], overrides = {}) => {
  const actorIds = actors.map(a => a.id);
  return await Input.query().insert({
    account_id: account.id,
    app_id: account.app_id,
    prompt: overrides.prompt || "A magical adventure in the backyard",
    actor_ids: actorIds, // Now it's JSONB, so we can pass the array directly
    metadata: {
      length: "short",
      tone: "adventurous",
      ...overrides.metadata
    },
  });
};

export const createArtifact = async (input, overrides = {}) => {
  return await Artifact.query().insert({
    input_id: input.id,
    account_id: input.account_id,
    app_id: input.app_id,
    artifact_type: overrides.artifact_type || "story",
    title: overrides.title || "The Great Adventure",
    metadata: {
      status: "completed",
      generated_at: new Date().toISOString(),
      ...overrides.metadata
    },
  });
};

export const createMedia = async (actor, overrides = {}) => {
  return await Media.query().insert({
    owner_type: "actor",
    owner_id: actor.id,
    image_key: overrides.image_key || `img_${faker.string.alphanumeric(10)}`,
    metadata: {
      upload_status: "uploaded",
      file_size: 1024 * 100, // 100KB
      dimensions: { width: 512, height: 512 },
      ...overrides.metadata
    },
  });
};

export const createSubscription = async (account, overrides = {}) => {
  return await Subscription.query().insert({
    account_id: account.id,
    rc_user_id: overrides.rc_user_id || account.clerk_id,
    rc_entitlement: overrides.rc_entitlement || "pro_access",
    rc_product_id: overrides.rc_product_id || "pro_monthly",
    rc_period_type: overrides.rc_period_type || "normal",
    rc_renewal_status: overrides.rc_renewal_status || "active",
    rc_platform: overrides.rc_platform || "ios",
    rc_expiration: overrides.rc_expiration || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    metadata: {
      ...overrides.metadata
    },
  });
};

export const createAuthenticatedUser = async (options = {}) => {
  let app;
  if (options.app) {
    // Reuse existing app
    app = options.app;
  } else if (options.appSlug) {
    // Try to find existing app with this slug, or create with timestamp
    app = await createApp({ 
      slug: `${options.appSlug}-${Date.now()}-${faker.string.alphanumeric(4)}` 
    });
  } else {
    // Create new app
    app = await createApp();
  }
  
  const account = await createAccount(app, { 
    clerk_id: options.userId || `clerk_${faker.string.alphanumeric(10)}`,
    ...options.accountOverrides 
  });

  return { 
    app, 
    account, 
    userId: account.clerk_id,
    headers: createAuthHeaders(account.clerk_id, app.slug)
  };
};

export const createLinkedFamilies = async (existingApp = null) => {
  const app = existingApp || await createApp();
  const timestamp = Date.now();
  const accountA = await createAccount(app, { clerk_id: `user_a_${timestamp}` });
  const accountB = await createAccount(app, { clerk_id: `user_b_${timestamp}` });

  // Create family link
  const { AccountLink } = await import("#src/models/index.js");
  await AccountLink.query().insert({
    account_id: accountA.id,
    linked_account_id: accountB.id,
    app_id: app.id,
    status: "accepted",
    created_by_id: accountA.id,
    metadata: {}
  });

  return {
    app,
    userA: { 
      app: app,
      account: accountA, 
      headers: createAuthHeaders(accountA.clerk_id, app.slug) 
    },
    userB: { 
      app: app,
      account: accountB, 
      headers: createAuthHeaders(accountB.clerk_id, app.slug) 
    }
  };
};

// Helper to create auth headers
const createAuthHeaders = (userId, appSlug = "test-app") => {
  return {
    "X-App-Slug": appSlug,
    "X-Test-User-Id": userId,
  };
};