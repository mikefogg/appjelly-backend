/**
 * Post/Artifact Serializers
 * Standardizes all post/artifact response shapes
 */

import { connectionBasicSerializer } from "./connection-serializer.js";

/**
 * Basic input info for embedded responses
 */
export const inputBasicSerializer = (input) => input ? ({
  id: input.id,
  prompt: input.prompt,
}) : null;

/**
 * Connected account info for post responses
 */
export const postConnectionSerializer = (connection) => connection ? ({
  id: connection.id,
  platform: connection.platform,
  username: connection.username,
}) : null;

/**
 * Post list item (GET /posts)
 */
export const postListSerializer = (artifact) => ({
  id: artifact.id,
  status: artifact.status,
  content: artifact.content,
  character_count: artifact.content?.length || 0,
  is_draft: artifact.isDraft(),
  angle: artifact.input?.metadata?.angle || artifact.metadata?.angle || null,
  length: artifact.input?.metadata?.length || artifact.metadata?.length || null,
  topics: artifact.metadata?.topics || [],
  input: inputBasicSerializer(artifact.input),
  connected_account: postConnectionSerializer(artifact.connected_account),
  created_at: artifact.created_at,
  updated_at: artifact.updated_at,
});

/**
 * Post detail (GET /posts/:id)
 */
export const postDetailSerializer = (artifact) => ({
  id: artifact.id,
  status: artifact.status,
  content: artifact.content,
  character_count: artifact.content?.length || 0,
  angle: artifact.input?.metadata?.angle || artifact.metadata?.angle || null,
  length: artifact.input?.metadata?.length || artifact.metadata?.length || null,
  topics: artifact.metadata?.topics || [],
  input: inputBasicSerializer(artifact.input),
  connected_account: postConnectionSerializer(artifact.connected_account),
  generation_info: {
    total_tokens: artifact.total_tokens,
    cost_usd: artifact.cost_usd,
    generation_time_seconds: artifact.generation_time_seconds,
    ai_model: artifact.ai_model,
  },
  metadata: artifact.metadata,
  created_at: artifact.created_at,
  updated_at: artifact.updated_at,
});

/**
 * Draft creation response (POST /posts/drafts)
 */
export const draftCreateSerializer = (artifact, connection) => ({
  id: artifact.id,
  status: "draft",
  content: artifact.content,
  character_count: artifact.content.length,
  connected_account: postConnectionSerializer(connection),
  created_at: artifact.created_at,
});

/**
 * Post generation pending response (POST /posts/generate)
 */
export const postGeneratePendingSerializer = (artifact, input, connection) => ({
  id: artifact.id,
  status: "pending",
  message: "Post generation queued",
  input: inputBasicSerializer(input),
  connected_account: postConnectionSerializer(connection),
});

/**
 * Post update response (PATCH /posts/:id)
 */
export const postUpdateSerializer = (artifact, content) => ({
  id: artifact.id,
  content,
  message: "Post updated successfully",
});

/**
 * Post improvement response (POST /posts/:id/improve)
 */
export const postImprovementSerializer = (original, improved, instructions, aiResponse, generationTime) => ({
  original: {
    content: original.content,
    character_count: original.content.length,
  },
  improved: {
    content: improved,
    character_count: improved.length,
  },
  instructions: instructions || null,
  generation_info: {
    total_tokens: aiResponse.usage.totalTokens,
    cost_usd: aiResponse.cost,
    generation_time_seconds: generationTime,
    ai_model: aiResponse.model,
  },
  message: "AI improvement generated. Use PATCH /posts/:id to save if you like it.",
});
