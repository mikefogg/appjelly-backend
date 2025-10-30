/**
 * Digest Recent Topics Job
 * Analyzes recent posts from a curated topic and extracts trending topics/themes
 * Queued automatically after sync-curated-topic completes
 */

import { CuratedTopic, NetworkPost, TrendingTopic } from "#src/models/index.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const JOB_DIGEST_RECENT_TOPICS = "digest-recent-topics";

// Minimum posts needed to run a digest
const MIN_POSTS_FOR_DIGEST = 10;

// Trending topics expire after 48 hours
const TRENDING_TOPIC_EXPIRY_HOURS = 48;

/**
 * Use AI to analyze posts and extract trending topics
 */
async function extractTrendingTopics(posts, topicName) {
  if (posts.length === 0) return [];

  try {
    const prompt = `Analyze these recent posts from the "${topicName}" category and identify 5-10 trending topics or themes.

For each trending topic:
1. Identify the specific topic/theme/event being discussed
2. Provide brief context (1-2 sentences) explaining what's happening
3. List which post indices (0-based) discuss this topic

Posts:
${posts.map((p, i) => `[${i}] "${p.content.substring(0, 200)}${p.content.length > 200 ? '...' : ''}" (${p.engagement_score} engagement)`).join('\n\n')}

Return ONLY a JSON object with this structure:
{
  "trending_topics": [
    {
      "topic": "Specific topic name",
      "context": "Brief 1-2 sentence explanation of what's happening",
      "post_indices": [0, 3, 5]
    }
  ]
}

Focus on:
- Specific projects, events, or developments (not generic themes)
- Topics with high engagement or multiple mentions
- Recent news or breaking developments
- Limit to 5-10 most significant topics`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You analyze social media posts to identify trending topics and themes. Return only valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.5,
      max_tokens: 1500,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result.trending_topics || [];

  } catch (error) {
    console.error(`[Digest Recent Topics] AI extraction failed:`, error.message);
    return [];
  }
}

export default async function digestRecentTopics(job) {
  const { curatedTopicId } = job.data;

  console.log(`[Digest Recent Topics] Starting digest for topic: ${curatedTopicId}`);

  try {
    // Get curated topic
    const topic = await CuratedTopic.query().findById(curatedTopicId);

    if (!topic) {
      throw new Error(`Curated topic ${curatedTopicId} not found`);
    }

    console.log(`[Digest Recent Topics] Digesting "${topic.name}" (${topic.slug})`);

    // Get posts since last digest (or all posts if never digested)
    const sinceTime = topic.last_digested_at
      ? new Date(topic.last_digested_at)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago if never digested

    const recentPosts = await NetworkPost.query()
      .where("curated_topic_id", topic.id)
      .where("posted_at", ">", sinceTime.toISOString())
      .orderBy("engagement_score", "desc")
      .orderBy("posted_at", "desc")
      .limit(100); // Analyze top 100 posts

    console.log(`[Digest Recent Topics] Found ${recentPosts.length} posts since ${sinceTime.toISOString()}`);

    if (recentPosts.length < MIN_POSTS_FOR_DIGEST) {
      console.log(`[Digest Recent Topics] Not enough posts (need ${MIN_POSTS_FOR_DIGEST}, have ${recentPosts.length}), skipping digest`);
      return {
        success: true,
        skipped: true,
        reason: "Not enough posts",
        posts_found: recentPosts.length,
      };
    }

    // Extract trending topics using AI
    console.log(`[Digest Recent Topics] Analyzing ${recentPosts.length} posts with AI...`);
    const trendingTopics = await extractTrendingTopics(recentPosts, topic.name);

    console.log(`[Digest Recent Topics] AI identified ${trendingTopics.length} trending topics`);

    if (trendingTopics.length === 0) {
      console.log(`[Digest Recent Topics] No trending topics identified`);
      await topic.$query().patch({
        last_digested_at: new Date().toISOString(),
      });
      return {
        success: true,
        trending_topics_found: 0,
      };
    }

    // Store trending topics in database
    let stored = 0;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TRENDING_TOPIC_EXPIRY_HOURS * 60 * 60 * 1000);

    for (const trendingTopic of trendingTopics) {
      try {
        // Map post indices to actual post IDs
        const samplePostIds = [];
        let mentionCount = 0;
        let totalEngagement = 0;

        if (trendingTopic.post_indices && Array.isArray(trendingTopic.post_indices)) {
          for (const index of trendingTopic.post_indices) {
            if (index >= 0 && index < recentPosts.length) {
              const post = recentPosts[index];
              samplePostIds.push(post.id);
              totalEngagement += parseFloat(post.engagement_score || 0);
              mentionCount++;
            }
          }
        }

        // Store trending topic
        await TrendingTopic.query().insert({
          curated_topic_id: topic.id,
          topic_name: trendingTopic.topic,
          context: trendingTopic.context,
          mention_count: mentionCount,
          total_engagement: totalEngagement,
          sample_post_ids: samplePostIds,
          detected_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        });

        console.log(
          `[Digest Recent Topics] ✓ Stored: "${trendingTopic.topic}" ` +
          `(${mentionCount} mentions, ${totalEngagement.toFixed(1)} engagement)`
        );

        stored++;

      } catch (error) {
        console.warn(`[Digest Recent Topics] Failed to store trending topic:`, error.message);
      }
    }

    // Update topic's last_digested_at
    await topic.$query().patch({
      last_digested_at: now.toISOString(),
    });

    // Cleanup expired trending topics
    await TrendingTopic.cleanupExpired();

    console.log(
      `[Digest Recent Topics] ✅ Digest complete for "${topic.name}": ` +
      `${stored} trending topics stored (expire at ${expiresAt.toISOString()})`
    );

    return {
      success: true,
      topic: topic.name,
      posts_analyzed: recentPosts.length,
      trending_topics_found: trendingTopics.length,
      trending_topics_stored: stored,
      expires_at: expiresAt.toISOString(),
    };

  } catch (error) {
    console.error(`[Digest Recent Topics] Error:`, error);
    throw error;
  }
}
