import { mediaService } from "#src/helpers/index.js";

export const inputSerializer = async (input) => {
  const media = input.media && input.media.length > 0 
    ? await Promise.all(input.media.map(mediaItemSerializer))
    : [];

  return {
    id: input.id,
    prompt: input.prompt,
    actor_ids: input.actor_ids,
    account_id: input.account_id,
    app_id: input.app_id,
    metadata: input.metadata,
    created_at: input.created_at,
    updated_at: input.updated_at,
    actors: input.actors ? input.actors.map(actor => ({
      id: actor.id,
      name: actor.name,
      type: actor.type,
      metadata: actor.metadata
    })) : [],
    media,
    artifacts_count: input.artifacts?.length || 0,
    latest_artifact: input.artifacts?.[0] ? {
      id: input.artifacts[0].id,
      title: input.artifacts[0].title,
      artifact_type: input.artifacts[0].artifact_type,
      status: input.artifacts[0].metadata?.status || "completed",
      created_at: input.artifacts[0].created_at,
    } : null,
  };
};

export const inputWithArtifactSerializer = async (input, artifact) => {
  const baseData = await inputSerializer(input);
  
  return {
    ...baseData,
    artifact: artifact ? {
      id: artifact.id,
      title: artifact.title,
      artifact_type: artifact.artifact_type,
      status: artifact.metadata?.status || "generating",
      created_at: artifact.created_at,
    } : null,
  };
};

export const inputListSerializer = async (inputs, pagination = {}) => {
  const data = await Promise.all(inputs.map(inputSerializer));
  
  return {
    data,
    meta: {
      total: inputs.length,
      pagination: pagination,
    },
  };
};

// Safe input serializer for shared contexts - no personal info
export const safeInputSerializer = async (input) => {
  const media = input.media && input.media.length > 0 
    ? await Promise.all(input.media.map(mediaItemSerializer))
    : [];

  return {
    id: input.id,
    prompt: input.prompt,
    actors: input.actors ? input.actors.map(actor => ({
      id: actor.id,
      name: actor.name,
      type: actor.type,
    })) : [],
    media,
    created_at: input.created_at,
  };
};

const mediaItemSerializer = async (media) => {
  const [imageUrl, thumbnailUrl] = await Promise.all([
    mediaService.getSignedImageUrl(media.image_key, "public"),
    mediaService.getSignedImageUrl(media.image_key, "thumbnail")
  ]);

  return {
    id: media.id,
    image_key: media.image_key,
    image_url: imageUrl,
    thumbnail_url: thumbnailUrl,
    metadata: media.metadata,
    created_at: media.created_at,
  };
};