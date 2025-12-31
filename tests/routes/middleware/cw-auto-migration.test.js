import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { knex, Account } from "#src/models/index.js";
import { createGhostApp } from "../../helpers/ghost-helpers.js";
import { faker } from "@faker-js/faker";
import app from "#src/index.js";

// Use vi.hoisted to create mock that can be used in vi.mock factory
const { mockQueueAdd } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue({ id: "test-job-123" }),
}));

vi.mock("#src/background/queues/index.js", () => ({
  ghostQueue: {
    add: mockQueueAdd,
  },
  JOB_MIGRATE_CW_CAPTIONS: "migrate-cw-captions",
}));

describe("CW Auto-Migration on Account Creation", () => {
  let ghostApp;
  let testCwUserId;
  const testEmail = `cw-test-${Date.now()}@example.com`;
  const testClerkId = `clerk_test_${faker.string.alphanumeric(10)}`;

  // Generate unique CW user ID for each test run
  const getNextCwUserId = () => {
    testCwUserId = (testCwUserId || 900000) + 1;
    return testCwUserId;
  };

  // Counter for caption IDs
  let captionIdCounter = 800000;
  const getNextCaptionId = () => ++captionIdCounter;

  beforeEach(async () => {
    // Reset mocks
    mockQueueAdd.mockClear();

    // Create Ghost app
    ghostApp = await createGhostApp({ slug: "ghost" });

    // Clean up any existing test data
    await knex("cw_captions").whereIn(
      "user_id",
      knex("cw_users").select("id").whereRaw("LOWER(email) = LOWER(?)", [testEmail])
    ).del();
    await knex("cw_users").whereRaw("LOWER(email) = LOWER(?)", [testEmail]).del();
    await knex("accounts")
      .where("clerk_id", testClerkId)
      .where("app_id", ghostApp.id)
      .del();
  });

  it("auto-queues migration for new user with matching CW email", async () => {
    // Create CW user with captions
    const cwUserId = getNextCwUserId();
    const [cwUser] = await knex("cw_users")
      .insert({
        id: cwUserId,
        email: testEmail,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning("*");

    // Create some captions for this CW user
    await knex("cw_captions").insert([
      {
        id: getNextCaptionId(),
        user_id: cwUser.id,
        local_id: "caption-1",
        name: "Test Caption 1",
        content: "Hello world",
        network: "instagram",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: getNextCaptionId(),
        user_id: cwUser.id,
        local_id: "caption-2",
        name: "Test Caption 2",
        content: "Another post",
        network: "twitter",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // Simulate new user auth request (this triggers account creation)
    const response = await request(app)
      .get("/accounts/me")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail);

    expect(response.status).toBe(200);

    // Verify migration job was queued
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "migrate-cw-captions",
      expect.objectContaining({
        cwUserId: cwUser.id,
        ghostAppId: ghostApp.id,
      })
    );

    // Verify CW user was linked
    const updatedCwUser = await knex("cw_users").where("id", cwUser.id).first();
    expect(updatedCwUser.ghost_account_id).toBeTruthy();
    expect(updatedCwUser.migrated_at).toBeTruthy();
  });

  it("links CW account but does not queue job when no captions exist", async () => {
    // Create CW user WITHOUT captions
    const cwUserId = getNextCwUserId();
    const [cwUser] = await knex("cw_users")
      .insert({
        id: cwUserId,
        email: testEmail,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning("*");

    // Simulate new user auth request
    const response = await request(app)
      .get("/accounts/me")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail);

    expect(response.status).toBe(200);

    // Verify migration job was NOT queued (no captions)
    expect(mockQueueAdd).not.toHaveBeenCalled();

    // But CW user should still be linked
    const updatedCwUser = await knex("cw_users").where("id", cwUser.id).first();
    expect(updatedCwUser.ghost_account_id).toBeTruthy();
    expect(updatedCwUser.migrated_at).toBeTruthy();
  });

  it("does not migrate already-migrated CW user", async () => {
    // Create a Ghost account first
    const existingAccount = await Account.query().insert({
      clerk_id: `clerk_existing_${faker.string.alphanumeric(10)}`,
      email: testEmail,
      app_id: ghostApp.id,
    });

    // Create CW user that's already migrated
    await knex("cw_users").insert({
      id: getNextCwUserId(),
      email: testEmail,
      ghost_account_id: existingAccount.id,
      migrated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Simulate NEW user auth request with same email
    const response = await request(app)
      .get("/accounts/me")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail);

    expect(response.status).toBe(200);

    // Verify no migration job was queued (already migrated)
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("does not attempt migration for non-Ghost apps", async () => {
    // Create a different app
    const { App } = await import("#src/models/index.js");
    const otherApp = await App.query()
      .insert({
        slug: `other-app-${Date.now()}`,
        name: "Other App",
        config: {},
      });

    // Create CW user with captions
    const cwUserId = getNextCwUserId();
    const [cwUser] = await knex("cw_users")
      .insert({
        id: cwUserId,
        email: testEmail,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning("*");

    await knex("cw_captions").insert({
      id: getNextCaptionId(),
      user_id: cwUser.id,
      local_id: "caption-1",
      content: "Test content",
      network: "instagram",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Simulate auth request to OTHER app (not Ghost)
    const response = await request(app)
      .get("/accounts/me")
      .set("X-App-Slug", otherApp.slug)
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail);

    expect(response.status).toBe(200);

    // Verify no migration job was queued (not Ghost app)
    expect(mockQueueAdd).not.toHaveBeenCalled();

    // CW user should NOT be linked
    const updatedCwUser = await knex("cw_users").where("id", cwUser.id).first();
    expect(updatedCwUser.ghost_account_id).toBeNull();
  });

  it("handles case-insensitive email matching", async () => {
    // Create CW user with lowercase email
    const cwUserId = getNextCwUserId();
    const [cwUser] = await knex("cw_users")
      .insert({
        id: cwUserId,
        email: testEmail.toLowerCase(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning("*");

    await knex("cw_captions").insert({
      id: getNextCaptionId(),
      user_id: cwUser.id,
      local_id: "caption-1",
      content: "Test content",
      network: "instagram",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Simulate auth with UPPERCASE email
    const response = await request(app)
      .get("/accounts/me")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail.toUpperCase());

    expect(response.status).toBe(200);

    // Should still match and queue migration
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "migrate-cw-captions",
      expect.objectContaining({
        cwUserId: cwUser.id,
      })
    );
  });

  it("only migrates captions without migrated_at timestamp", async () => {
    // Create CW user
    const cwUserId = getNextCwUserId();
    const [cwUser] = await knex("cw_users")
      .insert({
        id: cwUserId,
        email: testEmail,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning("*");

    // Create mix of migrated and unmigrated captions
    await knex("cw_captions").insert([
      {
        id: getNextCaptionId(),
        user_id: cwUser.id,
        local_id: "caption-migrated",
        content: "Already migrated",
        network: "instagram",
        migrated_at: new Date().toISOString(), // Already migrated
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: getNextCaptionId(),
        user_id: cwUser.id,
        local_id: "caption-pending",
        content: "Not yet migrated",
        network: "instagram",
        migrated_at: null, // Not migrated
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // Simulate auth request
    const response = await request(app)
      .get("/accounts/me")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail);

    expect(response.status).toBe(200);

    // Migration should be queued (1 unmigrated caption exists)
    expect(mockQueueAdd).toHaveBeenCalled();
  });

  it("does not crash account creation if queue fails", async () => {
    // Make the queue throw an error
    mockQueueAdd.mockRejectedValueOnce(new Error("Redis connection failed"));

    // Create CW user with captions
    const cwUserId = getNextCwUserId();
    const [cwUser] = await knex("cw_users")
      .insert({
        id: cwUserId,
        email: testEmail,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning("*");

    await knex("cw_captions").insert({
      id: getNextCaptionId(),
      user_id: cwUser.id,
      local_id: "caption-1",
      content: "Test content",
      network: "instagram",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Account creation should still succeed even if queue fails
    const response = await request(app)
      .get("/accounts/me")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail);

    // Should still return 200, not crash
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBeTruthy();
  });

  it("does not crash account creation if no matching CW user exists", async () => {
    // No CW user created - just make the request
    const response = await request(app)
      .get("/accounts/me")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", "nonexistent@example.com");

    // Should succeed without issues
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBeTruthy();

    // No migration should be queued
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("does not queue migration when all captions already migrated", async () => {
    // Create CW user
    const cwUserId = getNextCwUserId();
    const [cwUser] = await knex("cw_users")
      .insert({
        id: cwUserId,
        email: testEmail,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning("*");

    // Create only migrated captions
    await knex("cw_captions").insert({
      id: getNextCaptionId(),
      user_id: cwUser.id,
      local_id: "caption-migrated",
      content: "Already migrated",
      network: "instagram",
      migrated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Simulate auth request
    const response = await request(app)
      .get("/accounts/me")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail);

    expect(response.status).toBe(200);

    // No migration should be queued (all captions already migrated)
    expect(mockQueueAdd).not.toHaveBeenCalled();

    // But account should still be linked
    const updatedCwUser = await knex("cw_users").where("id", cwUser.id).first();
    expect(updatedCwUser.ghost_account_id).toBeTruthy();
  });
});
