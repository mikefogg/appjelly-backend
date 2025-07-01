import { mediaService } from "#src/helpers/index.js";
import { inputSerializer as properInputSerializer, safeInputSerializer as properSafeInputSerializer } from "#src/serializers/input-serializer.js";
import { ArtifactActor } from "#src/models/index.js";

export const artifactSerializer = async (artifact) => {
  return {
    id: artifact.id,
    artifact_type: artifact.artifact_type,
    title: artifact.title,
    metadata: artifact.metadata,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
    input: artifact.input ? await properInputSerializer(artifact.input) : null,
    owner: artifact.account ? {
      id: artifact.account.id,
      display_name: artifact.account.metadata?.display_name,
    } : null,
    page_count: artifact.pages?.length || 0,
    status: artifact.metadata?.status || "completed",
  };
};

export const artifactWithPagesSerializer = async (artifact) => {
  const baseData = await artifactSerializer(artifact);
  
  return {
    ...baseData,
    pages: artifact.pages ? artifact.pages.map(pageSerializer) : [],
  };
};

export const artifactListSerializer = (artifacts, pagination = {}) => {
  return {
    data: artifacts.map(artifactSerializer),
    meta: {
      total: artifacts.length,
      pagination: pagination,
    },
  };
};

export const pageSerializer = (page) => {
  return {
    id: page.id,
    page_number: page.page_number,
    text: page.text,
    image_key: page.image_key,
    image_url: page.image_key ? mediaService.getImageUrl(page.image_key) : null,
    layout_data: page.layout_data,
    created_at: page.created_at,
  };
};

export const pageWithArtifactSerializer = (page, artifact) => {
  return {
    ...pageSerializer(page),
    artifact: {
      id: artifact.id,
      title: artifact.title,
      total_pages: artifact.pages?.length || 0,
    },
  };
};


// Safe artifact serializer for shared contexts - no owner/account info
export const safeArtifactSerializer = async (artifact) => {
  return {
    id: artifact.id,
    artifact_type: artifact.artifact_type,
    title: artifact.title,
    created_at: artifact.created_at,
    input: artifact.input ? await properSafeInputSerializer(artifact.input) : null,
    page_count: artifact.pages?.length || 0,
    status: artifact.metadata?.status || "completed",
  };
};

export const safeArtifactWithPagesSerializer = async (artifact) => {
  const baseData = await safeArtifactSerializer(artifact);
  
  return {
    ...baseData,
    pages: artifact.pages ? artifact.pages.map(pageSerializer) : [],
  };
};

export const sharedArtifactSerializer = async (sharedView) => {
  const artifact = sharedView.artifact;
  
  // Get actors associated with this artifact
  const artifactActors = await ArtifactActor.query()
    .where("artifact_id", artifact.id)
    .withGraphFetched("[actor.account(publicProfile)]")
    .modifiers({
      publicProfile: (builder) => {
        builder.select("id", "metadata");
      },
    });

  const actors = artifactActors.map(aa => ({
    id: aa.actor.id,
    name: aa.actor.name,
    type: aa.actor.type,
    is_main_character: aa.is_main_character,
    is_claimable: aa.actor.is_claimable, // Any actor can be claimed if marked claimable
    owner: aa.actor.account ? {
      id: aa.actor.account.id,
      display_name: aa.actor.account.metadata?.display_name || "Family Member"
    } : null
  }));

  const baseArtifact = await safeArtifactWithPagesSerializer(artifact);
  
  return {
    token: sharedView.token,
    permissions: sharedView.permissions,
    expires_at: sharedView.metadata?.expires_at,
    artifact: {
      ...baseArtifact,
      actors: actors
    },
    shared_at: sharedView.created_at,
  };
};