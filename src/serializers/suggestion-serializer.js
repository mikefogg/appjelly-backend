/**
 * Suggestion Serializers
 * Standardizes all suggestion response shapes
 */

/**
 * Network profile author info
 */
export const authorSerializer = (profile) => profile ? ({
  username: profile.username,
  display_name: profile.display_name,
  profile_image_url: profile.profile_image_url,
}) : null;

/**
 * Source post basic info
 */
export const sourcePostBasicSerializer = (post) => post ? ({
  id: post.id,
  content: post.content,
  posted_at: post.posted_at,
  engagement_score: post.engagement_score,
  author: {
    username: post.network_profile?.username,
    display_name: post.network_profile?.display_name,
  },
}) : null;

/**
 * Source post detail info (includes profile image)
 */
export const sourcePostDetailSerializer = (post) => post ? ({
  id: post.id,
  content: post.content,
  posted_at: post.posted_at,
  engagement_score: post.engagement_score,
  author: authorSerializer(post.network_profile),
}) : null;

/**
 * Inspiring network post serializer
 */
export const inspiringPostSerializer = (post) => ({
  id: post.id,
  content: post.content,
  posted_at: post.posted_at,
  engagement_score: post.engagement_score,
  like_count: post.like_count,
  retweet_count: post.retweet_count,
  reply_count: post.reply_count,
  topics: post.topics,
  author: authorSerializer(post.network_profile),
});

/**
 * Suggestion list item (GET /suggestions)
 */
export const suggestionListSerializer = (suggestion) => ({
  id: suggestion.id,
  batch_id: suggestion.batch_id,
  suggestion_type: suggestion.suggestion_type,
  content: suggestion.content,
  reasoning: suggestion.reasoning,
  character_count: suggestion.character_count,
  topics: suggestion.topics,
  angle: suggestion.angle,
  length: suggestion.length,
  status: suggestion.status,
  source_post: sourcePostBasicSerializer(suggestion.source_post),
  created_at: suggestion.created_at,
  expires_at: suggestion.expires_at,
});

/**
 * Suggestion detail (GET /suggestions/:id)
 */
export const suggestionDetailSerializer = (suggestion, inspiringPosts = []) => ({
  id: suggestion.id,
  batch_id: suggestion.batch_id,
  suggestion_type: suggestion.suggestion_type,
  content: suggestion.content,
  reasoning: suggestion.reasoning,
  character_count: suggestion.character_count,
  topics: suggestion.topics,
  angle: suggestion.angle,
  length: suggestion.length,
  status: suggestion.status,
  source_post: sourcePostDetailSerializer(suggestion.source_post),
  inspiring_posts: inspiringPosts.map(inspiringPostSerializer),
  metadata: {
    generation_type: suggestion.metadata?.generation_type,
    trending_topics_count: suggestion.metadata?.trending_topics_count,
    trending_posts_count: suggestion.metadata?.trending_posts_count,
  },
  connected_account: {
    id: suggestion.connected_account.id,
    platform: suggestion.connected_account.platform,
    username: suggestion.connected_account.username,
  },
  created_at: suggestion.created_at,
  expires_at: suggestion.expires_at,
});

/**
 * Suggestion use response (POST /suggestions/:id/use)
 */
export const suggestionUseSerializer = (suggestion, nextRecommended) => ({
  message: "Suggestion marked as used",
  status: "used",
  updated_rotation: nextRecommended ? {
    last_content_type: suggestion.content_type,
    last_posted_at: new Date(),
    next_recommended: nextRecommended,
  } : null,
});

/**
 * Suggestion dismiss response
 */
export const suggestionDismissSerializer = (dismissedAt) => ({
  message: "Suggestion dismissed",
  dismissed_at: dismissedAt,
});

/**
 * Generate response pending (POST /suggestions/:id/generate-response)
 */
export const generateResponsePendingSerializer = (artifact, input, sourcePost, sourceAuthor) => ({
  id: artifact.id,
  status: "pending",
  message: "Response generation queued",
  input: {
    id: input.id,
    prompt: input.prompt,
  },
  reply_to: {
    post_id: sourcePost.id,
    author: sourceAuthor,
    content: sourcePost.content,
  },
});

/**
 * Reply opportunity serializer
 */
export const replyOpportunitySerializer = (post) => ({
  id: post.id,
  content: post.content,
  posted_at: post.posted_at,
  engagement_score: post.engagement_score,
  like_count: post.like_count,
  retweet_count: post.retweet_count,
  reply_count: post.reply_count,
  author: authorSerializer(post.network_profile),
});

/**
 * Generate suggestions queued response
 */
export const generateSuggestionsQueuedSerializer = (connectionId, generationStartedAt) => ({
  message: "Suggestion generation queued",
  generation_started_at: generationStartedAt,
  polling_instructions: {
    poll_endpoint: `/suggestions?connected_account_id=${connectionId}`,
    check_for_suggestions_created_after: generationStartedAt,
    estimated_completion_seconds: 15,
    recommended_poll_interval_ms: 2000,
  },
});

/**
 * Suggestion from topic response
 */
export const suggestionFromTopicSerializer = (suggestion, trendingTopic, nextType) => ({
  suggestion: {
    id: suggestion.id,
    content: suggestion.content,
    content_type: suggestion.content_type,
    angle: suggestion.angle,
    character_count: suggestion.character_count,
    status: suggestion.status,
    created_at: suggestion.created_at,
  },
  source_topic: {
    id: trendingTopic.id,
    topic_name: trendingTopic.topic_name,
    context: trendingTopic.context,
    curated_topic_slug: trendingTopic.curated_topic.slug,
  },
  next_recommended: nextType,
});
