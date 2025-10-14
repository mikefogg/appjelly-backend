import { beforeAll, afterAll, beforeEach, vi } from "vitest";
import { knex } from "#src/models/index.js";
import mockFetch from "../test-utils/mockFetch.js";

// Global Clerk authentication mock
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (req, res, next) => {
    req.auth = () => ({ userId: req.headers["x-test-user-id"] || null });
    next();
  },
  requireAuth: () => (req, res, next) => {
    if (!req.headers["x-test-user-id"]) {
      return res.status(401).json({ error: { message: "Unauthorized", code: 401 } });
    }
    req.auth = () => ({ userId: req.headers["x-test-user-id"] });
    next();
  },
}));

// Global OpenAI mock
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockImplementation((params) => {
          const systemPrompt = params.messages?.find(m => m.role === "system")?.content || "";
          const userPrompt = params.messages?.find(m => m.role === "user")?.content || "";

          // Ghost post generation
          if (systemPrompt.includes("social media ghostwriter") || systemPrompt.includes("post")) {
            return Promise.resolve({
              choices: [{
                message: {
                  content: "This is a generated post about the topic. It's engaging and authentic! 🚀"
                }
              }],
              usage: {
                total_tokens: 150,
                prompt_tokens: 100,
                completion_tokens: 50
              }
            });
          }

          // Ghost suggestion generation
          if (systemPrompt.includes("suggestions") || params.response_format?.type === "json_object") {
            if (systemPrompt.includes("reply")) {
              return Promise.resolve({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      reply: "Great point! I'd add that...",
                      reasoning: "This adds value to the conversation"
                    })
                  }
                }],
                usage: { total_tokens: 200, prompt_tokens: 150, completion_tokens: 50 }
              });
            }

            return Promise.resolve({
              choices: [{
                message: {
                  content: JSON.stringify({
                    suggestions: [
                      {
                        type: "original_post",
                        content: "Hot take: AI is transforming how we work",
                        reasoning: "Trending topic in the network",
                        topics: ["ai", "work"]
                      },
                      {
                        type: "original_post",
                        content: "Here's what I learned today about tech...",
                        reasoning: "Educational content performs well",
                        topics: ["tech", "learning"]
                      }
                    ]
                  })
                }
              }],
              usage: { total_tokens: 300, prompt_tokens: 200, completion_tokens: 100 }
            });
          }

          // Ghost style analysis
          if (systemPrompt.includes("writing style") || userPrompt.includes("Analyze these")) {
            return Promise.resolve({
              choices: [{
                message: {
                  content: JSON.stringify({
                    tone: "casual and conversational",
                    style_summary: "Uses clear language with occasional emojis. Focuses on practical insights and personal experiences.",
                    common_topics: ["tech", "ai", "productivity"],
                    characteristics: ["concise", "authentic", "thoughtful"]
                  })
                }
              }],
              usage: { total_tokens: 400, prompt_tokens: 300, completion_tokens: 100 }
            });
          }

          // Default fallback (old SnuggleBug format)
          return Promise.resolve({
            choices: [{
              message: {
                content: JSON.stringify({
                  characters: [],
                  pages: []
                })
              }
            }],
            usage: { total_tokens: 100, prompt_tokens: 50, completion_tokens: 50 }
          });
        })
      }
    },
    moderations: {
      create: vi.fn().mockResolvedValue({
        results: [{
          flagged: false,
          categories: {},
          category_scores: {}
        }]
      })
    }
  }))
}));

beforeAll(async () => {
  // Run migrations on test database
  await knex.migrate.latest();
});

beforeEach(async () => {
  // Clean all tables before each test
  await knex.raw(`
    TRUNCATE TABLE
      apps,
      accounts,
      subscriptions,
      connected_accounts,
      network_profiles,
      network_posts,
      user_post_history,
      post_suggestions,
      writing_styles,
      media,
      inputs,
      artifacts
    RESTART IDENTITY CASCADE
  `);

  // Reset all mocks
  vi.clearAllMocks();
  mockFetch.reset();
});

afterAll(async () => {
  // Restore mocks
  mockFetch.restore();

  // Close database connection
  await knex.destroy();
});