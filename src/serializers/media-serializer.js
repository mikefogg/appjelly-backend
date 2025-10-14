export const mediaSerializer = (media) => {
  const baseData = {
    id: media.id,
    owner_type: media.owner_type,
    owner_id: media.owner_id,
    media_type: media.media_type,
    image_key: media.image_key,
    image_url: media.image_url,
    metadata: media.metadata,
    created_at: media.created_at,
    updated_at: media.updated_at,
  };

  // Add video-specific fields
  if (media.media_type === 'video') {
    baseData.video_key = media.video_key;
    
    // Generate video URL based on storage type
    if (media.metadata?.local_storage && process.env.LOCAL_STORAGE === "true") {
      // Use local storage URL
      const filename = media.metadata?.filename || `${media.id}.mp4`;
      baseData.video_url = `/storage/videos/fursona/${filename}`;
    } else if (media.metadata?.r2_url) {
      // Use R2 URL
      baseData.video_url = media.metadata.r2_url;
    }
  }

  return baseData;
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
  const baseData = {
    id: media.id,
    media_type: media.media_type,
    owner_type: media.owner_type,
    owner_id: media.owner_id,
    metadata: media.metadata,
    created_at: media.created_at,
  };

  // Handle image media
  if (media.media_type === 'image' || media.image_key) {
    const [imageUrl, thumbnailUrl] = await Promise.all([
      mediaService.getSignedImageUrl(media.image_key, "public"),
      mediaService.getSignedImageUrl(media.image_key, "thumbnail")
    ]);

    baseData.image_key = media.image_key;
    baseData.image_url = imageUrl;
    baseData.thumbnail_url = thumbnailUrl;
  }

  // Handle video media
  if (media.media_type === 'video') {
    baseData.video_key = media.video_key;
    
    // Generate video URL based on storage type
    if (media.metadata?.local_storage && process.env.LOCAL_STORAGE === "true") {
      // Use local storage URL
      const filename = media.metadata?.filename || `${media.id}.mp4`;
      baseData.video_url = `/storage/videos/fursona/${filename}`;
    } else if (media.metadata?.r2_url) {
      // Use R2 URL
      baseData.video_url = media.metadata.r2_url;
    }
  }

  return baseData;
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