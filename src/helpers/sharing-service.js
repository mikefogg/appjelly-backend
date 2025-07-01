import QRCode from "qrcode";
import { randomBytes } from "crypto";
import { SharedView, Artifact, App, Actor } from "#src/models/index.js";

class SharingService {
  generateShareToken() {
    // Generate a token with share_ prefix using hex encoding to match test expectations
    const randomPart = randomBytes(16).toString("hex");
    return `share_${randomPart}`;
  }

  async createShareableLink(
    artifactId,
    accountId,
    options = { includeQR: true }
  ) {
    try {
      // Verify the artifact exists and belongs to the account
      const artifact = await Artifact.query()
        .findById(artifactId)
        .withGraphFetched("[app, account]");

      if (!artifact) {
        throw new Error("Artifact not found");
      }

      // Check if account has permission to share (owns it or is in a linked family)
      const canShare = await this.canShareArtifact(artifact, accountId);
      if (!canShare) {
        throw new Error("No permission to share this artifact");
      }

      // Always create a new shared view - each share should be unique
      // even with same permissions (might be shared to different people/groups)
      const token = this.generateShareToken();
      const sharedView = await SharedView.query().insert({
        artifact_id: artifactId,
        token,
        permissions: options.permissions || {
          can_view: true,
          can_repersonalize: true,
          can_claim_characters: true,
        },
        metadata: {
          active: true,
          created_by: accountId,
          created_at: new Date().toISOString(),
          app_slug: artifact.app.slug,
          ...options.metadata,
        },
      });

      // Generate the share URL
      const baseUrl =
        process.env.SHARE_BASE_URL ||
        `https://${artifact.app.slug}.appjelly.co`;
      const shareUrl = `${baseUrl}/shared/${sharedView.token}`;

      const result = {
        url: shareUrl,
        token: sharedView.token,
        short_url: await this.generateShortUrl(shareUrl),
        expires_at: sharedView.metadata?.expires_at || null,
      };

      // Generate QR code if requested
      if (options.includeQR) {
        const qrOptions = {
          errorCorrectionLevel: "M",
          type: "image/png",
          quality: 0.92,
          margin: 1,
          color: {
            dark: "#000000",
            light: "#FFFFFF",
          },
          width: 256,
        };

        result.qr_code = QRCode.toDataURL(shareUrl, qrOptions);
        result.qr_code_svg = await QRCode.toString(shareUrl, { type: "svg" });
      }

      // Add sharing message if provided
      if (options.message) {
        result.message = this.generateShareMessage(artifact, options.message);
      }

      return result;
    } catch (error) {
      console.error("Error creating shareable link:", error);
      throw error;
    }
  }

  async canShareArtifact(artifact, accountId) {
    // Owner can always share
    if (artifact.account_id === accountId) {
      return true;
    }

    // Check if user is in a linked family that has access
    const linkedFamilyAccess = await Artifact.query()
      .findById(artifact.id)
      .joinRelated("account.account_links")
      .where("account_links.linked_account_id", accountId)
      .where("account_links.status", "accepted")
      .first();

    return !!linkedFamilyAccess;
  }

  async generateShortUrl(longUrl) {
    // In production, integrate with a URL shortening service
    // For now, return a mock short URL
    const shortId = randomBytes(4).toString("base64url");
    return `${process.env.SHORT_URL_BASE || "https://sbug.link"}/${shortId}`;
  }

  generateShareMessage(artifact, customMessage) {
    const defaultMessages = {
      story: `Check out this amazing story: "${artifact.title}"! Your child can be part of the adventure too! 🌟`,
      image: `Look at this wonderful creation featuring ${
        artifact.metadata?.main_character || "your child"
      }! 🎨`,
      default: `I'd love to share this with you! ${artifact.title} 💫`,
    };

    if (customMessage) {
      return customMessage;
    }

    return defaultMessages[artifact.artifact_type] || defaultMessages.default;
  }

  async getSharedContent(token) {
    try {
      const sharedView = await SharedView.query()
        .findOne({ token })
        .withGraphFetched(
          "[artifact.[app, account, pages, artifact_inputs.[actors]]]"
        );

      if (!sharedView) {
        throw new Error("Shared view not found");
      }

      // Check if the share has expired
      if (sharedView.metadata?.expires_at) {
        const expiryDate = new Date(sharedView.metadata.expires_at);
        if (expiryDate < new Date()) {
          throw new Error("This share link has expired");
        }
      }

      // Check if the share is still active
      if (sharedView.metadata?.active === false) {
        throw new Error("This share link is no longer active");
      }

      // Increment view count
      await sharedView.$query().patch({
        metadata: {
          ...sharedView.metadata,
          view_count: (sharedView.metadata?.view_count || 0) + 1,
          last_viewed_at: new Date().toISOString(),
        },
      });

      return {
        shared_view: sharedView,
        artifact: sharedView.artifact,
        permissions: sharedView.permissions,
        characters: await this.extractCharactersFromArtifact(
          sharedView.artifact
        ),
      };
    } catch (error) {
      console.error("Error getting shared content:", error);
      throw error;
    }
  }

  async extractCharactersFromArtifact(artifact) {
    // Get all unique actors mentioned in the artifact
    const actorIds = new Set();

    // From artifact metadata
    if (artifact.metadata?.actor_ids) {
      artifact.metadata.actor_ids.forEach((id) => actorIds.add(id));
    }

    // From inputs
    if (artifact.artifact_inputs) {
      artifact.artifact_inputs.forEach((input) => {
        if (input.actor_ids) {
          input.actor_ids.forEach((id) => actorIds.add(id));
        }
      });
    }

    // Load actor details
    const actors = await Actor.query()
      .findByIds([...actorIds])
      .withGraphFetched("account");

    return actors.map((actor) => ({
      id: actor.id,
      name: actor.name,
      type: actor.type,
      is_claimed: !!actor.account_id,
      claimed_by: actor.account
        ? {
            id: actor.account.id,
            name: actor.account.metadata?.display_name || "A parent",
          }
        : null,
    }));
  }

  async revokeShare(artifactId, accountId) {
    const sharedView = await SharedView.query()
      .findOne({ artifact_id: artifactId })
      .where("metadata", "@>", JSON.stringify({ created_by: accountId }));

    if (!sharedView) {
      throw new Error(
        "Shared view not found or you do not have permission to revoke it"
      );
    }

    await sharedView.$query().patch({
      metadata: {
        ...sharedView.metadata,
        active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: accountId,
      },
    });

    return { success: true };
  }
}

export default new SharingService();
