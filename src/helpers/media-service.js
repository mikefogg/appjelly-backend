import sharp from "sharp";
import { randomBytes, createHmac } from "crypto";

class MediaService {
  constructor() {
    this.cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    this.cloudflareAccountHash = process.env.CLOUDFLARE_ACCOUNT_HASH;
    this.cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
    this.cloudflareSigningKey = process.env.CLOUDFLARE_IMAGES_SIGNING_KEY;
    this.cloudflareImagesUrl = `https://api.cloudflare.com/client/v4/accounts/${this.cloudflareAccountId}/images/v1`;
    this.cloudflareDirectUploadUrl = `https://api.cloudflare.com/client/v4/accounts/${this.cloudflareAccountId}/images/v2/direct_upload`;
  }

  generateImageKey(prefix = "img") {
    const timestamp = Date.now();
    const random = randomBytes(8).toString("hex");
    return `${prefix}_${timestamp}_${random}`;
  }

  async getSignedUploadUrl(contentType = "image/jpeg") {
    try {
      return this.getCloudflareUploadUrl();
    } catch (error) {
      console.error("Failed to generate upload URL:", error);
      throw new Error("Could not generate upload URL");
    }
  }

  async getCloudflareUploadUrl() {
    const formData = new FormData();
    // Remove custom ID - let Cloudflare auto-generate for signed URLs
    formData.append('requireSignedURLs', 'true'); // Enforce signed URLs for security
    formData.append('metadata', JSON.stringify({
      uploadedAt: new Date().toISOString(),
    }));

    const response = await fetch(this.cloudflareDirectUploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cloudflareApiToken}`,
      },
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error("Failed to get Cloudflare upload URL");
    }
    
    // Use the auto-generated ID from Cloudflare
    const cloudflareImageKey = data.result.id;
    
    return {
      uploadUrl: data.result.uploadURL,
      imageKey: cloudflareImageKey,
      imageUrl: `https://imagedelivery.net/${this.cloudflareAccountHash}/${cloudflareImageKey}`,
    };
  }

  async processImage(imageBuffer, options = {}) {
    try {
      const {
        width = 1024,
        height = 1024,
        quality = 80,
        format = "jpeg",
      } = options;

      let processor = sharp(imageBuffer);

      if (width || height) {
        processor = processor.resize(width, height, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }

      if (format === "jpeg") {
        processor = processor.jpeg({ quality });
      } else if (format === "png") {
        processor = processor.png({ quality });
      } else if (format === "webp") {
        processor = processor.webp({ quality });
      }

      return await processor.toBuffer();
    } catch (error) {
      console.error("Image processing error:", error);
      throw new Error("Failed to process image");
    }
  }

  async uploadProcessedImage(imageBuffer, imageKey, options = {}) {
    try {
      const processedBuffer = await this.processImage(imageBuffer, options);
      return this.uploadToCloudflare(processedBuffer, imageKey);
    } catch (error) {
      console.error("Failed to upload processed image:", error);
      throw new Error("Could not upload image");
    }
  }

  async uploadToCloudflare(imageBuffer, imageKey) {
    const formData = new FormData();
    formData.append("file", new Blob([imageBuffer]), imageKey);
    formData.append("id", imageKey);

    const response = await fetch(`${this.cloudflareImagesUrl}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cloudflareApiToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Failed to upload to Cloudflare");
    }

    const data = await response.json();
    return {
      imageKey,
      imageUrl: `https://imagedelivery.net/${this.cloudflareAccountHash}/${imageKey}`,
      variants: data.result.variants,
    };
  }

  async deleteImage(imageKey) {
    try {
      return this.deleteFromCloudflare(imageKey);
    } catch (error) {
      console.error("Failed to delete image:", error);
      throw new Error("Could not delete image");
    }
  }

  async deleteFromCloudflare(imageKey) {
    const response = await fetch(`${this.cloudflareImagesUrl}/${imageKey}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.cloudflareApiToken}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to delete from Cloudflare");
    }

    return { success: true };
  }

  // Generate signed URL for secure image access using local signing
  async getSignedImageUrl(imageKey, variant = "public", expiryMinutes = 60) {
    return this.generateLocalSignedUrl(imageKey, variant, expiryMinutes);
  }

  // Generate signed URL using local signing key (no API calls needed)
  generateLocalSignedUrl(imageKey, variant = "public", expiryMinutes = 60) {
    // In development/test mode without signing key, use fake tokens
    if (!this.cloudflareSigningKey || process.env.NODE_ENV === 'test') {
      const fakeToken = `dev-token-${Math.random().toString(36).substring(2, 15)}`;
      return `https://imagedelivery.net/${this.cloudflareAccountHash}/${imageKey}/${variant}?token=${fakeToken}`;
    }

    try {
      // Generate expiry timestamp
      const expiry = Math.floor(Date.now() / 1000) + (expiryMinutes * 60);
      
      // Create the URL path to sign
      const pathToSign = `/${this.cloudflareAccountHash}/${imageKey}/${variant}`;
      
      // Create the string to sign: "pathToSign?exp=expiry" (pathname + search params)
      const stringToSign = `${pathToSign}?exp=${expiry}`;
      
      // Generate HMAC signature using the signing key
      const signature = createHmac('sha256', this.cloudflareSigningKey)
        .update(stringToSign)
        .digest('hex'); // Use hex encoding for 64 hex characters
      
      // Build the signed URL
      return `https://imagedelivery.net${pathToSign}?exp=${expiry}&sig=${signature}`;
    } catch (error) {
      console.error("Failed to generate local signed URL:", error);
      // In development, fallback to fake token
      if (process.env.NODE_ENV === 'development') {
        const fakeToken = `dev-token-${Math.random().toString(36).substring(2, 15)}`;
        return `https://imagedelivery.net/${this.cloudflareAccountHash}/${imageKey}/${variant}?token=${fakeToken}`;
      }
      // In production, fallback to unsigned URL (not ideal but better than crashing)
      return `https://imagedelivery.net/${this.cloudflareAccountHash}/${imageKey}/${variant}`;
    }
  }

  // Generate signed URL for resized image
  async getSignedResizedImageUrl(imageKey, width, height, expiryMinutes = 60) {
    const variant = `w=${width},h=${height}`;
    return this.generateLocalSignedUrl(imageKey, variant, expiryMinutes);
  }

  // Batch generate signed URLs for multiple media items
  async addSignedUrlsToMediaArray(mediaArray) {
    if (!mediaArray || mediaArray.length === 0) {
      return [];
    }

    return await Promise.all(
      mediaArray.map(async (media) => {
        const [imageUrl, thumbnailUrl] = await Promise.all([
          this.getSignedImageUrl(media.image_key, "public"),
          this.getSignedImageUrl(media.image_key, "thumbnail")
        ]);

        return {
          ...media,
          image_url: imageUrl,
          thumbnail_url: thumbnailUrl,
        };
      })
    );
  }

  // Legacy methods (kept for backwards compatibility, but will use signed URLs)
  async getImageUrl(imageKey, variant = "public") {
    return this.generateLocalSignedUrl(imageKey, variant);
  }

  async getResizedImageUrl(imageKey, width, height) {
    const variant = `w=${width},h=${height}`;
    return this.generateLocalSignedUrl(imageKey, variant);
  }
}

export default new MediaService();
