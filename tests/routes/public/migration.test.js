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

describe("POST /migration/caption-writer", () => {
  let ghostApp;
  let testAccount;
  let testCwUserId;
  const testEmail = `cw-migration-test-${Date.now()}@example.com`;
  const testClerkId = `clerk_migration_test_${faker.string.alphanumeric(10)}`;

  // Generate unique CW user ID for each test run
  const getNextCwUserId = () => {
    testCwUserId = (testCwUserId || 950000) + 1;
    return testCwUserId;
  };

  // Counter for caption IDs
  let captionIdCounter = 850000;
  const getNextCaptionId = () => ++captionIdCounter;

  beforeEach(async () => {
    // Reset mocks
    mockQueueAdd.mockClear();

    // Create Ghost app
    ghostApp = await createGhostApp({ slug: "ghost" });

    // Clean up any existing test data
    await knex("cw_captions").whereIn(
      "user_id",
      knex("cw_users").select("id").whereRaw("LOWER(email) LIKE LOWER(?)", [`%migration-test%`])
    ).del();
    await knex("cw_users").whereRaw("LOWER(email) LIKE LOWER(?)", [`%migration-test%`]).del();
    await knex("accounts")
      .where("clerk_id", testClerkId)
      .where("app_id", ghostApp.id)
      .del();

    // Create test account
    testAccount = await Account.query().insert({
      clerk_id: testClerkId,
      email: testEmail,
      app_id: ghostApp.id,
    });
  });

  describe("finding CW users", () => {
    it("finds CW user by user_id", async () => {
      const cwUserId = getNextCwUserId();
      await knex("cw_users").insert({
        id: cwUserId,
        email: "other@example.com",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await knex("cw_captions").insert({
        id: getNextCaptionId(),
        user_id: cwUserId,
        local_id: "caption-1",
        content: "Test content",
        network: "instagram",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ user_id: cwUserId });

      expect(response.status).toBe(200);
      expect(response.body.data.migrated).toBe(true);
      expect(response.body.data.matched_by).toBe("user_id");
      expect(response.body.data.cw_user_id).toBe(cwUserId);
    });

    it("finds CW user by email", async () => {
      const cwUserId = getNextCwUserId();
      const cwEmail = `cw-migration-test-${cwUserId}@example.com`;
      await knex("cw_users").insert({
        id: cwUserId,
        email: cwEmail,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await knex("cw_captions").insert({
        id: getNextCaptionId(),
        user_id: cwUserId,
        local_id: "caption-1",
        content: "Test content",
        network: "instagram",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ email: cwEmail });

      expect(response.status).toBe(200);
      expect(response.body.data.migrated).toBe(true);
      expect(response.body.data.matched_by).toBe("email");
    });

    it("finds CW user by legacy_post_id (caption local_id)", async () => {
      const cwUserId = getNextCwUserId();
      await knex("cw_users").insert({
        id: cwUserId,
        email: `cw-migration-test-${cwUserId}@example.com`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const localId = `legacy-post-${Date.now()}`;
      await knex("cw_captions").insert({
        id: getNextCaptionId(),
        user_id: cwUserId,
        local_id: localId,
        content: "Test content",
        network: "instagram",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ legacy_post_id: localId });

      expect(response.status).toBe(200);
      expect(response.body.data.migrated).toBe(true);
      expect(response.body.data.matched_by).toBe("legacy_post_id");
    });

    it("returns no_matching_account when CW user not found", async () => {
      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ user_id: 999999999 });

      expect(response.status).toBe(200);
      expect(response.body.data.migrated).toBe(false);
      expect(response.body.data.reason).toBe("no_matching_account");
    });

    it("handles case-insensitive email matching", async () => {
      const cwUserId = getNextCwUserId();
      const cwEmail = `cw-migration-test-${cwUserId}@example.com`;
      await knex("cw_users").insert({
        id: cwUserId,
        email: cwEmail.toLowerCase(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await knex("cw_captions").insert({
        id: getNextCaptionId(),
        user_id: cwUserId,
        local_id: "caption-1",
        content: "Test content",
        network: "instagram",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ email: cwEmail.toUpperCase() });

      expect(response.status).toBe(200);
      expect(response.body.data.migrated).toBe(true);
    });
  });

  describe("migration process", () => {
    it("queues migration job when captions exist", async () => {
      const cwUserId = getNextCwUserId();
      await knex("cw_users").insert({
        id: cwUserId,
        email: `cw-migration-test-${cwUserId}@example.com`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await knex("cw_captions").insert([
        {
          id: getNextCaptionId(),
          user_id: cwUserId,
          local_id: "caption-1",
          content: "Test content 1",
          network: "instagram",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: getNextCaptionId(),
          user_id: cwUserId,
          local_id: "caption-2",
          content: "Test content 2",
          network: "twitter",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ user_id: cwUserId });

      expect(response.status).toBe(200);
      expect(response.body.data.migrated).toBe(true);
      expect(response.body.data.drafts_queued).toBe(2);
      expect(response.body.data.drafts_total).toBe(2);

      expect(mockQueueAdd).toHaveBeenCalledWith(
        "migrate-cw-captions",
        expect.objectContaining({
          cwUserId: cwUserId,
          ghostAccountId: testAccount.id,
          ghostAppId: ghostApp.id,
        }),
        expect.objectContaining({
          jobId: `migrate-cw-${cwUserId}`,
        })
      );
    });

    it("does not queue job when no captions exist", async () => {
      const cwUserId = getNextCwUserId();
      await knex("cw_users").insert({
        id: cwUserId,
        email: `cw-migration-test-${cwUserId}@example.com`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ user_id: cwUserId });

      expect(response.status).toBe(200);
      expect(response.body.data.migrated).toBe(true);
      expect(response.body.data.drafts_queued).toBe(0);

      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it("links CW user to Ghost account", async () => {
      const cwUserId = getNextCwUserId();
      await knex("cw_users").insert({
        id: cwUserId,
        email: `cw-migration-test-${cwUserId}@example.com`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ user_id: cwUserId });

      const updatedCwUser = await knex("cw_users").where("id", cwUserId).first();
      expect(updatedCwUser.ghost_account_id).toBe(testAccount.id);
      expect(updatedCwUser.migrated_at).toBeTruthy();
    });

    it("returns already_linked when CW user is already linked to same account", async () => {
      const cwUserId = getNextCwUserId();
      await knex("cw_users").insert({
        id: cwUserId,
        email: `cw-migration-test-${cwUserId}@example.com`,
        ghost_account_id: testAccount.id,
        migrated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ user_id: cwUserId });

      expect(response.status).toBe(200);
      expect(response.body.data.migrated).toBe(true);
      expect(response.body.data.already_linked).toBe(true);
    });

    it("returns already_migrated_to_different_account when CW user linked to different account", async () => {
      const otherAccount = await Account.query().insert({
        clerk_id: `clerk_other_${faker.string.alphanumeric(10)}`,
        email: "other@example.com",
        app_id: ghostApp.id,
      });

      const cwUserId = getNextCwUserId();
      await knex("cw_users").insert({
        id: cwUserId,
        email: `cw-migration-test-${cwUserId}@example.com`,
        ghost_account_id: otherAccount.id,
        migrated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ user_id: cwUserId });

      expect(response.status).toBe(200);
      expect(response.body.data.migrated).toBe(false);
      expect(response.body.data.reason).toBe("already_migrated_to_different_account");
    });
  });

  describe("validation", () => {
    it("requires at least one identifier", async () => {
      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", "ghost")
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({});

      expect(response.status).toBe(400);
    });

    it("rejects non-Ghost apps", async () => {
      const { App } = await import("#src/models/index.js");
      const otherApp = await App.query().insert({
        slug: `other-app-${Date.now()}`,
        name: "Other App",
        config: {},
      });

      const otherAccount = await Account.query().insert({
        clerk_id: testClerkId,
        email: testEmail,
        app_id: otherApp.id,
      });

      const response = await request(app)
        .post("/migration/caption-writer")
        .set("X-App-Slug", otherApp.slug)
        .set("X-Test-User-Id", testClerkId)
        .set("X-Test-User-Email", testEmail)
        .send({ user_id: 123 });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain("only available for Ghost app");
    });
  });
});

describe("GET /migration/caption-writer/status", () => {
  let ghostApp;
  let testAccount;
  let testCwUserId = 960000;
  const testEmail = `cw-status-test-${Date.now()}@example.com`;
  const testClerkId = `clerk_status_test_${faker.string.alphanumeric(10)}`;

  const getNextCwUserId = () => ++testCwUserId;
  let captionIdCounter = 860000;
  const getNextCaptionId = () => ++captionIdCounter;

  beforeEach(async () => {
    ghostApp = await createGhostApp({ slug: "ghost" });

    await knex("cw_captions").whereIn(
      "user_id",
      knex("cw_users").select("id").whereRaw("LOWER(email) LIKE LOWER(?)", [`%status-test%`])
    ).del();
    await knex("cw_users").whereRaw("LOWER(email) LIKE LOWER(?)", [`%status-test%`]).del();
    await knex("accounts")
      .where("clerk_id", testClerkId)
      .where("app_id", ghostApp.id)
      .del();

    testAccount = await Account.query().insert({
      clerk_id: testClerkId,
      email: testEmail,
      app_id: ghostApp.id,
    });
  });

  it("returns linked: false when no CW user linked", async () => {
    const response = await request(app)
      .get("/migration/caption-writer/status")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail);

    expect(response.status).toBe(200);
    expect(response.body.data.linked).toBe(false);
    expect(response.body.data.cw_user).toBeNull();
  });

  it("returns migration status when CW user is linked", async () => {
    const cwUserId = getNextCwUserId();
    await knex("cw_users").insert({
      id: cwUserId,
      email: `cw-status-test-${cwUserId}@example.com`,
      ghost_account_id: testAccount.id,
      migrated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await knex("cw_captions").insert([
      {
        id: getNextCaptionId(),
        user_id: cwUserId,
        local_id: "caption-1",
        content: "Migrated",
        network: "instagram",
        migrated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: getNextCaptionId(),
        user_id: cwUserId,
        local_id: "caption-2",
        content: "Pending",
        network: "instagram",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: getNextCaptionId(),
        user_id: cwUserId,
        local_id: "caption-3",
        content: "Failed",
        network: "instagram",
        migration_error: JSON.stringify({ message: "Test error" }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    const response = await request(app)
      .get("/migration/caption-writer/status")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail);

    expect(response.status).toBe(200);
    expect(response.body.data.linked).toBe(true);
    expect(response.body.data.cw_user.id).toBe(cwUserId);
    expect(response.body.data.migration_status.total_captions).toBe(3);
    expect(response.body.data.migration_status.migrated).toBe(1);
    expect(response.body.data.migration_status.pending).toBe(2);
    expect(response.body.data.migration_status.failed).toBe(1);
    expect(response.body.data.migration_status.complete).toBe(false);
  });

  it("shows complete: true when all captions migrated", async () => {
    const cwUserId = getNextCwUserId();
    await knex("cw_users").insert({
      id: cwUserId,
      email: `cw-status-test-${cwUserId}@example.com`,
      ghost_account_id: testAccount.id,
      migrated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await knex("cw_captions").insert({
      id: getNextCaptionId(),
      user_id: cwUserId,
      local_id: "caption-1",
      content: "Migrated",
      network: "instagram",
      migrated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const response = await request(app)
      .get("/migration/caption-writer/status")
      .set("X-App-Slug", "ghost")
      .set("X-Test-User-Id", testClerkId)
      .set("X-Test-User-Email", testEmail);

    expect(response.status).toBe(200);
    expect(response.body.data.migration_status.complete).toBe(true);
    expect(response.body.data.migration_status.progress_percent).toBe(100);
  });
});
