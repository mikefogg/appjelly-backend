/**
 * Topic Serializers
 * Standardizes all topic response shapes
 */

/**
 * Curated topic list item (GET /topics)
 */
export const curatedTopicListSerializer = (topic) => ({
  id: topic.id,
  slug: topic.slug,
  name: topic.name,
  description: topic.description,
  is_active: topic.is_active,
});

/**
 * Trending topic basic serializer
 */
export const trendingTopicSerializer = (topic) => ({
  id: topic.id,
  topic_name: topic.topic_name,
  context: topic.context,
  mention_count: topic.mention_count,
  total_engagement: parseFloat(topic.total_engagement || 0),
  detected_at: topic.detected_at,
  expires_at: topic.expires_at,
});

/**
 * Topic trending response (GET /topics/:topicId/trending)
 */
export const topicTrendingResponseSerializer = (topic, trendingTopics) => ({
  curated_topic: {
    id: topic.id,
    slug: topic.slug,
    name: topic.name,
    last_synced_at: topic.last_synced_at,
    last_digested_at: topic.last_digested_at,
  },
  trending_topics: trendingTopics.map(trendingTopicSerializer),
});
