import { mediaService } from "#src/helpers/index.js";
import { inputSerializer as properInputSerializer, safeInputSerializer as properSafeInputSerializer } from "#src/serializers/input-serializer.js";
import { ArtifactActor } from "#src/models/index.js";

export const artifactSerializer = async (artifact) => {
  return {
    id: artifact.id,
    artifact_type: artifact.artifact_type,
    title: artifact.title,
    subtitle: artifact.subtitle,
    description: artifact.description,
    status: artifact.status || "pending",
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
    
    // Relationships
    input: artifact.input ? await properInputSerializer(artifact.input) : null,
    owner: artifact.account ? {
      id: artifact.account.id,
      display_name: artifact.account.metadata?.display_name,
    } : null,
    page_count: artifact.pages?.length || 0,
  };
};

export const artifactWithPagesSerializer = async (artifact) => {
  const baseData = await artifactSerializer(artifact);
  
  return {
    ...baseData,
    pages: artifact.pages ? await Promise.all(artifact.pages.map(pageSerializer)) : [],
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

export const pageSerializer = async (page) => {
  return {
    id: page.id,
    page_number: page.page_number,
    text: page.text,
    image_key: page.image_key,
    image_url: page.image_key ? await mediaService.getImageUrl(page.image_key) : null,
    image_status: page.image_status || "pending",
    layout_data: page.layout_data,
    created_at: page.created_at,
  };
};

export const pageWithArtifactSerializer = async (page, artifact) => {
  return {
    ...(await pageSerializer(page)),
    artifact: {
      id: artifact.id,
      title: artifact.title,
      total_pages: artifact.pages?.length || 0,
    },
  };
};


// Safe artifact serializer for shared contexts - no owner/account info or cost data
export const safeArtifactSerializer = async (artifact) => {
  return {
    id: artifact.id,
    artifact_type: artifact.artifact_type,
    title: artifact.title,
    subtitle: artifact.subtitle,
    description: artifact.description,
    status: artifact.status || "pending",
    created_at: artifact.created_at,
    input: artifact.input ? await properSafeInputSerializer(artifact.input) : null,
    page_count: artifact.pages?.length || 0,
    // Exclude: token counts, costs, AI model info for privacy
  };
};

export const safeArtifactWithPagesSerializer = async (artifact) => {
  const baseData = await safeArtifactSerializer(artifact);
  
  return {
    ...baseData,
    pages: artifact.pages ? await Promise.all(artifact.pages.map(pageSerializer)) : [],
  };
};

// Admin serializer with full technical details for internal use
export const adminArtifactSerializer = async (artifact) => {
  const baseData = await artifactSerializer(artifact);
  
  return {
    ...baseData,
    metadata: artifact.metadata,
    
    // Token and cost tracking (admin only)
    total_tokens: artifact.total_tokens,
    plotline_tokens: artifact.plotline_tokens,
    story_tokens: artifact.story_tokens,
    plotline_prompt_tokens: artifact.plotline_prompt_tokens,
    plotline_completion_tokens: artifact.plotline_completion_tokens,
    story_prompt_tokens: artifact.story_prompt_tokens,
    story_completion_tokens: artifact.story_completion_tokens,
    cost_usd: artifact.cost_usd,
    generation_time_seconds: artifact.generation_time_seconds,
    
    // AI model info (admin only)
    ai_model: artifact.ai_model,
    ai_provider: artifact.ai_provider,
  };
};

// Admin page serializer with technical details
export const adminPageSerializer = async (page) => {
  const baseData = await pageSerializer(page);
  
  return {
    ...baseData,
    image_prompt: page.image_prompt, // Only for admin
    
    // Image generation tracking (admin only)
    image_generation_cost_usd: page.image_generation_cost_usd,
    image_generation_time_seconds: page.image_generation_time_seconds,
    image_ai_model: page.image_ai_model,
    image_ai_provider: page.image_ai_provider,
    image_generated_at: page.image_generated_at,
    image_prompt_used: page.image_prompt_used,
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