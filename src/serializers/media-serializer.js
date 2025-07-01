export const mediaSerializer = (media) => {
  return {
    id: media.id,
    owner_type: media.owner_type,
    owner_id: media.owner_id,
    image_key: media.image_key,
    image_url: media.image_url,
    metadata: media.metadata,
    created_at: media.created_at,
    updated_at: media.updated_at,
  };
};

export const mediaUploadSerializer = (media, uploadData) => {
  return {
    media_id: media.id,
    image_key: media.image_key,
    upload_url: uploadData.uploadUrl,
    image_url: uploadData.imageUrl,
  };
};

export const batchUploadSerializer = (uploads) => {
  return {
    upload_urls: uploads,
    batch_id: `batch_${Date.now()}`,
    expires_in: 3600,
  };
};

export const mediaDetailSerializer = async (media, mediaService) => {
  const [imageUrl, thumbnailUrl] = await Promise.all([
    mediaService.getSignedImageUrl(media.image_key, "public"),
    mediaService.getSignedImageUrl(media.image_key, "thumbnail")
  ]);

  return {
    id: media.id,
    image_key: media.image_key,
    image_url: imageUrl,
    thumbnail_url: thumbnailUrl,
    owner_type: media.owner_type,
    owner_id: media.owner_id,
    metadata: media.metadata,
    created_at: media.created_at,
  };
};

export const mediaListSerializer = (mediaList, pagination) => {
  return {
    media: mediaList,
    meta: {
      total: mediaList.length,
      per_page: parseInt(pagination.per_page),
      has_more: mediaList.length === parseInt(pagination.per_page),
    },
  };
};