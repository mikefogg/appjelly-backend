import { describe, it, expect, beforeEach, vi } from "vitest";
import app from "#src/index.js";
import { expectSuccessResponse, expectErrorResponse, expectUnauthenticatedError, expectValidationError } from "../../helpers/assertions.js";
import {
  createTestContext,
  authenticatedRequest,
  unauthenticatedRequest,
} from "../../helpers/ghost-helpers.js";
import { CuratedTopic, UserTopicPreference } from "#src/models/index.js";

describe("Topics Routes", () => {
  let context;
  let testTopics;

  beforeEach(async () => {
    context = await createTestContext();
    vi.clearAllMocks();

    // Create test topics with unique slugs
    const uniqueId = Date.now() + Math.random().toString(36).substring(7);
    testTopics = await Promise.all([
      CuratedTopic.query().insert({
        slug: `ai-test-${uniqueId}`,
        name: "AI Test Topic",
        description: "Test topic for AI",
        is_active: true,
      }),
      CuratedTopic.query().insert({
        slug: `crypto-test-${uniqueId}`,
        name: "Crypto Test Topic",
        description: "Test topic for Crypto",
        is_active: true,
      }),
      CuratedTopic.query().insert({
        slug: `startups-test-${uniqueId}`,
        name: "Startups Test Topic",
        description: "Test topic for Startups",
        is_active: true,
      }),
    ]);
  });

  describe("GET /topics", () => {
    it("returns list of all curated topics", async () => {
      const response = await authenticatedRequest(app, "get", "/topics");

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);

      const firstTopic = data[0];
      expect(firstTopic).toHaveProperty("id");
      expect(firstTopic).toHaveProperty("slug");
      expect(firstTopic).toHaveProperty("name");
      expect(firstTopic).toHaveProperty("description");
      expect(firstTopic).toHaveProperty("is_active");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(app, "get", "/topics");
      expectUnauthenticatedError(response);
    });
  });

  describe("GET /connections/:id/topics", () => {
    it("returns empty array when no topics selected", async () => {
      const response = await authenticatedRequest(
        app,
        "get",
        `/connections/${context.connectedAccount.id}/topics`
      );

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    });

    it("returns selected topics", async () => {
      // Select 2 topics
      await UserTopicPreference.setUserTopics(context.connectedAccount.id, [
        testTopics[0].id,
        testTopics[1].id,
      ]);

      const response = await authenticatedRequest(
        app,
        "get",
        `/connections/${context.connectedAccount.id}/topics`
      );

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);

      const firstTopic = data[0];
      expect(firstTopic).toHaveProperty("id");
      expect(firstTopic).toHaveProperty("slug");
      expect(firstTopic).toHaveProperty("name");
      expect(firstTopic).toHaveProperty("selected_at");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "get",
        `/connections/${context.connectedAccount.id}/topics`
      );
      expectUnauthenticatedError(response);
    });

    it("returns 404 for non-existent connection", async () => {
      const response = await authenticatedRequest(
        app,
        "get",
        `/connections/00000000-0000-0000-0000-000000000000/topics`
      );

      expectErrorResponse(response, 404);
    });
  });

  describe("PUT /connections/:id/topics", () => {
    it("sets user topic preferences", async () => {
      const response = await authenticatedRequest(
        app,
        "put",
        `/connections/${context.connectedAccount.id}/topics`
      ).send({
        topic_ids: [testTopics[0].id, testTopics[1].id],
      });

      const data = expectSuccessResponse(response);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe(testTopics[0].id);
      expect(data[1].id).toBe(testTopics[1].id);
    });

    it("replaces existing topic preferences", async () => {
      // First set 2 topics
      await UserTopicPreference.setUserTopics(context.connectedAccount.id, [
        testTopics[0].id,
        testTopics[1].id,
      ]);

      // Then replace with just 1 topic
      const response = await authenticatedRequest(
        app,
        "put",
        `/connections/${context.connectedAccount.id}/topics`
      ).send({
        topic_ids: [testTopics[2].id],
      });

      const data = expectSuccessResponse(response);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(testTopics[2].id);
    });

    it("validates topic IDs exist", async () => {
      const response = await authenticatedRequest(
        app,
        "put",
        `/connections/${context.connectedAccount.id}/topics`
      ).send({
        topic_ids: ["00000000-0000-0000-0000-000000000000"],
      });

      expectErrorResponse(response, 400);
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "put",
        `/connections/${context.connectedAccount.id}/topics`
      ).send({
        topic_ids: [testTopics[0].id],
      });
      expectUnauthenticatedError(response);
    });

    it("validates topic_ids is an array", async () => {
      const response = await authenticatedRequest(
        app,
        "put",
        `/connections/${context.connectedAccount.id}/topics`
      ).send({
        topic_ids: "not-an-array",
      });

      expectValidationError(response, "topic_ids");
    });
  });

  describe("GET /topics/:topicId/trending", () => {
    it("returns trending topics for a curated topic", async () => {
      const response = await authenticatedRequest(
        app,
        "get",
        `/topics/${testTopics[0].id}/trending`
      );

      const data = expectSuccessResponse(response);
      expect(data).toHaveProperty("curated_topic");
      expect(data).toHaveProperty("trending_topics");
      expect(Array.isArray(data.trending_topics)).toBe(true);

      expect(data.curated_topic.id).toBe(testTopics[0].id);
      expect(data.curated_topic).toHaveProperty("slug");
      expect(data.curated_topic).toHaveProperty("name");
    });

    it("requires authentication", async () => {
      const response = await unauthenticatedRequest(
        app,
        "get",
        `/topics/${testTopics[0].id}/trending`
      );
      expectUnauthenticatedError(response);
    });

    it("returns 404 for non-existent topic", async () => {
      const response = await authenticatedRequest(
        app,
        "get",
        `/topics/00000000-0000-0000-0000-000000000000/trending`
      );

      expectErrorResponse(response, 404);
    });
  });
});
