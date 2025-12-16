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
export const postDetailSerializer = (artifact, { totalVersions } = {}) => ({
  id: artifact.id,
  status: artifact.status,
  content: artifact.content,
  character_count: artifact.content?.length || 0,
  current_version: artifact.current_version_number || 1,
  total_versions: totalVersions ?? artifact.current_version_number ?? 1,
  angle: artifact.input?.metadata?.angle || artifact.metadata?.angle || null,
  length: artifact.input?.metadata?.length || artifact.metadata?.length || null,
  topics: artifact.metadata?.topics || [],
  input: inputBasicSerializer(artifact.input),
  connected_account: postConnectionSerializer(artifact.connected_account),
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
 * Now auto-saves and creates a new version
 */
export const postImprovementSerializer = (artifact, improved, instructions, versionInfo) => ({
  id: artifact.id,
  original: {
    content: artifact.content,
    character_count: artifact.content.length,
  },
  improved: {
    content: improved,
    character_count: improved.length,
  },
  instructions: instructions || null,
  version_info: versionInfo ? {
    version_number: versionInfo.version_number,
    source_type: versionInfo.source_type,
    previous_version: (versionInfo.version_number || 1) - 1,
  } : null,
  message: versionInfo
    ? `AI improvement saved as version ${versionInfo.version_number}`
    : "AI improvement generated",
});

/**
 * Version list item (GET /posts/:id/versions)
 */
export const versionListItemSerializer = (version, currentVersionNumber) => ({
  version_number: version.version_number,
  source_type: version.source_type,
  source_metadata: version.source_metadata || null,
  content_preview: version.content?.substring(0, 100) + (version.content?.length > 100 ? "..." : ""),
  character_count: version.content?.length || 0,
  is_current: version.version_number === currentVersionNumber,
  created_at: version.created_at,
});

/**
 * Version list response (GET /posts/:id/versions)
 */
export const versionListSerializer = (postId, currentVersionNumber, versions) => ({
  post_id: postId,
  current_version: currentVersionNumber,
  versions: versions.map(v => versionListItemSerializer(v, currentVersionNumber)),
});

/**
 * Version detail (GET /posts/:id/versions/:version_number)
 */
export const versionDetailSerializer = (version, currentVersionNumber) => ({
  version_number: version.version_number,
  source_type: version.source_type,
  source_metadata: version.source_metadata || null,
  content: version.content,
  character_count: version.content?.length || 0,
  is_current: version.version_number === currentVersionNumber,
  created_at: version.created_at,
});

/**
 * Rollback response (POST /posts/:id/versions/:version_number/rollback)
 */
export const rollbackSerializer = (artifact, version, rolledBackFrom) => ({
  id: artifact.id,
  content: artifact.content,
  character_count: artifact.content?.length || 0,
  current_version: version.version_number,
  version_info: {
    version_number: version.version_number,
    source_type: "rollback",
    source_metadata: {
      rolled_back_from: rolledBackFrom,
    },
    created_at: version.created_at,
  },
  message: `Rolled back to version ${rolledBackFrom}`,
});
