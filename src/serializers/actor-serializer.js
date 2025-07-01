import { mediaService } from "#src/helpers/index.js";

export const actorSerializer = async (actor) => {
  const media = actor.media && actor.media.length > 0 
    ? await Promise.all(actor.media.map(mediaItemSerializer))
    : [];

  return {
    id: actor.id,
    account_id: actor.account_id,
    app_id: actor.app_id,
    name: actor.name,
    type: actor.type,
    metadata: actor.metadata,
    media,
    created_at: actor.created_at,
    updated_at: actor.updated_at,
    owner: actor.account ? {
      id: actor.account.id,
      display_name: actor.account.metadata?.display_name,
    } : null,
  };
};

// Safe serializer for public/shared contexts - ONLY exposes name
export const publicActorSerializer = (actor) => {
  return {
    id: actor.id,
    name: actor.name,
    type: actor.type,
  };
};

export const actorListSerializer = async (actors, pagination = {}) => {
  const data = await Promise.all(actors.map(actorSerializer));
  
  return {
    data,
    meta: {
      total: actors.length,
      pagination: pagination,
    },
  };
};

export const actorWithAccessSerializer = async (actor) => {
  // Use full serializer only for owned actors, public serializer for linked actors
  const baseData = actor.access_type === "linked" 
    ? publicActorSerializer(actor)
    : await actorSerializer(actor);
  
  return {
    ...baseData,
    access_type: actor.access_type || "owned", // owned, linked, shared
    is_linked_family: actor.access_type === "linked",
    // Only show owner info for owned actors
    account: actor.access_type === "owned" ? baseData.owner : null,
    owner: actor.access_type === "owned" ? baseData.owner : null,
    permissions: actor.permissions || {
      view: true,
      use_in_stories: true,
      edit: actor.access_type === "owned",
    },
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