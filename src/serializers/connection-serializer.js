/**
 * Connection Serializers
 * Standardizes all connected account response shapes
 */

/**
 * Basic connection info for lists and embedded responses
 */
export const connectionBasicSerializer = (connection) => ({
  id: connection.id,
  platform: connection.platform,
  username: connection.username,
});

/**
 * Connection list item (GET /connections)
 */
export const connectionListSerializer = (connection, syncInfo) => ({
  id: connection.id,
  platform: connection.platform,
  label: connection.label,
  username: connection.username,
  display_name: connection.display_name,
  platform_user_id: connection.platform_user_id,
  profile_data: connection.profile_data,
  is_active: connection.is_active,
  is_default: connection.is_default,
  is_deletable: connection.is_deletable,
  is_connected: !!connection.connected_account_auth_id,
  voice: connection.voice,
  topics_of_interest: connection.topics_of_interest,
  bio: connection.bio || {},
  content_preferences: connection.getContentPreferences(),
  sync_info: syncInfo,
  is_ready_for_generation: connection.isReadyForGeneration(),
  is_generating_voice: connection.isVoiceGenerating(),
  is_generating_suggestions: connection.isSuggestionsGenerating(),
  created_at: connection.created_at,
});

/**
 * Calculate voice confidence from stats
 * 5% per sample (max 50%), 5% per feedback (max 50%), 2% per rule (max 10%), 5% per bio field (max 20%), capped at 100%
 */
const calculateVoiceConfidence = (sampleCount, feedbackCount, rulesCount, bio = {}) => {
  const sampleScore = Math.min(sampleCount * 5, 50);
  const feedbackScore = Math.min(feedbackCount * 5, 50);
  const rulesScore = Math.min(rulesCount * 2, 10);

  // Count filled bio fields (what_you_do, audience, perspective, differentiator)
  const bioFields = ['what_you_do', 'audience', 'perspective', 'differentiator'];
  const filledBioCount = bioFields.filter(field => bio[field] && bio[field].trim()).length;
  const bioScore = filledBioCount * 5; // 5% per field, max 20%

  return Math.min(sampleScore + feedbackScore + rulesScore + bioScore, 100);
};

/**
 * Full connection details (GET /connections/:id)
 */
export const connectionDetailSerializer = (connection, { recommendations, syncInfo, voiceStats, account }) => {
  const samplePostsCount = connection.sample_posts?.length || 0;
  const rulesCount = voiceStats?.rulesCount || 0;
  const feedbackCount = voiceStats?.feedbackCount || 0;
  const bio = connection.bio || {};
  const voiceConfidence = calculateVoiceConfidence(samplePostsCount, feedbackCount, rulesCount, bio);

  return {
    id: connection.id,
    platform: connection.platform,
    label: connection.label,
    username: connection.username,
    display_name: connection.display_name,
    platform_user_id: connection.platform_user_id,
    profile_data: connection.profile_data,
    is_active: connection.is_active,
    is_default: connection.is_default,
    is_deletable: connection.is_deletable,
    is_connected: !!connection.connected_account_auth_id,
    voice: connection.voice,
    topics_of_interest: connection.topics_of_interest,
    bio: connection.bio || {},
    content_preferences: connection.getContentPreferences(),
    recommendations,
    sync_info: syncInfo,
    voice_profile: connection.voiceProfile ? {
      version: connection.voiceProfile.version,
      voice_summary: connection.voiceProfile.voice_summary,
      examples: connection.voiceProfile.examples,
      created_at: connection.voiceProfile.created_at,
    } : null,
    voice_stats: {
      sample_posts_count: samplePostsCount,
      rules_count: rulesCount,
      feedback_count: feedbackCount,
      confidence: voiceConfidence,
    },
    is_ready_for_generation: connection.isReadyForGeneration(),
    is_generating_voice: connection.isVoiceGenerating(),
    is_generating_suggestions: connection.isSuggestionsGenerating(),
    generation_time: connection.generation_time,
    next_batch_at: connection.getNextBatchAt?.(account) || null,
    created_at: connection.created_at,
  };
};

/**
 * Connection update response (PATCH /connections/:id)
 */
export const connectionUpdateSerializer = (connection) => ({
  id: connection.id,
  label: connection.label,
  voice: connection.voice,
  topics_of_interest: connection.topics_of_interest,
  content_preferences: connection.getContentPreferences(),
  message: "Connection updated successfully",
});

/**
 * OAuth connection response
 */
export const connectionOAuthSerializer = (connection) => ({
  id: connection.id,
  platform: connection.platform,
  label: connection.label,
  username: connection.username,
  is_connected: !!connection.connected_account_auth_id,
  sync_status: connection.sync_status,
  last_synced_at: connection.last_synced_at,
  created_at: connection.created_at,
});

/**
 * Sample post serializer
 */
export const samplePostSerializer = (samplePost) => ({
  id: samplePost.id,
  content: samplePost.content,
  notes: samplePost.notes,
  sort_order: samplePost.sort_order,
  created_at: samplePost.created_at,
  updated_at: samplePost.updated_at,
});

/**
 * Rule serializer
 */
export const ruleSerializer = (rule) => ({
  id: rule.id,
  rule_type: rule.rule_type,
  content: rule.content,
  priority: rule.priority,
  is_active: rule.is_active,
  created_at: rule.created_at,
  updated_at: rule.updated_at,
});

/**
 * User topic preference serializer
 */
export const userTopicSerializer = (pref) => ({
  id: pref.curated_topic.id,
  slug: pref.curated_topic.slug,
  name: pref.curated_topic.name,
  description: pref.curated_topic.description,
  selected_at: pref.created_at,
});

/**
 * Trending topic serializer for connection context
 */
export const connectionTrendingSerializer = (topic) => ({
  id: topic.id,
  curated_topic: {
    id: topic.curated_topic.id,
    slug: topic.curated_topic.slug,
    name: topic.curated_topic.name,
    topic_type: topic.curated_topic.topic_type,
  },
  topic_name: topic.topic_name,
  context: topic.context,
  topic_type: topic.topic_type,
  mention_count: topic.mention_count,
  total_engagement: parseFloat(topic.total_engagement || 0),
  detected_at: topic.detected_at,
  expires_at: topic.expires_at,
});

/**
 * Connection trending response (GET /connections/:id/trending)
 */
export const connectionTrendingResponseSerializer = (connection, { recommendedContentType, trendingTopics }) => ({
  rotation_info: {
    current_content_type: recommendedContentType,
    last_post: connection.last_posted_at ? {
      content_type: connection.last_content_type,
      posted_at: connection.last_posted_at,
    } : null,
    rotation_enabled: connection.getContentPreferences().rotation_enabled,
  },
  trending_topics: trendingTopics.map(connectionTrendingSerializer),
});

/**
 * Rotation settings response
 */
export const rotationSettingsSerializer = (connection, nextRecommended) => ({
  rotation_enabled: connection.getContentPreferences().rotation_enabled,
  last_content_type: connection.last_content_type,
  last_posted_at: connection.last_posted_at,
  next_recommended: nextRecommended,
});
