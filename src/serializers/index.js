export {
  appSerializer,
  appListSerializer,
  appConfigSerializer,
} from "#src/serializers/app-serializer.js";

export {
  accountSerializer,
  currentAccountSerializer,
  publicAccountSerializer,
} from "#src/serializers/account-serializer.js";

export {
  actorSerializer,
  actorListSerializer,
  actorWithAccessSerializer,
  publicActorSerializer,
} from "#src/serializers/actor-serializer.js";

export {
  artifactSerializer,
  artifactWithPagesSerializer,
  artifactListSerializer,
  sharedArtifactSerializer,
  safeArtifactSerializer,
  safeArtifactWithPagesSerializer,
  pageSerializer,
  pageWithArtifactSerializer,
} from "#src/serializers/artifact-serializer.js";

export {
  subscriptionSerializer,
  subscriptionStatusSerializer,
  paywallSerializer,
} from "#src/serializers/subscription-serializer.js";

export {
  inputSerializer,
  inputWithArtifactSerializer,
  inputListSerializer,
  safeInputSerializer,
} from "#src/serializers/input-serializer.js";

export {
  inferenceSerializer,
} from "#src/serializers/inference-serializer.js";

export {
  mediaSerializer,
  mediaUploadSerializer,
  batchUploadSerializer,
  mediaDetailSerializer,
  mediaListSerializer,
} from "#src/serializers/media-serializer.js";

export {
  accountLinkSerializer,
  accountLinkListSerializer,
} from "#src/serializers/account-link-serializer.js";

export {
  contentReportSerializer,
  contentGuidelinesSerializer,
  contentModerationSerializer,
  safetyTipsSerializer,
} from "#src/serializers/content-safety-serializer.js";

export {
  sampleStorySerializer,
  onboardingCompleteSerializer,
  suggestionsSerializer,
} from "#src/serializers/onboarding-serializer.js";

export {
  sharedViewSerializer,
  claimCharacterSerializer,
} from "#src/serializers/shared-view-serializer.js";

export const successResponse = (data, message = "Success") => {
  return {
    code: 200,
    status: "Success",
    message,
    data,
  };
};

export const createdResponse = (data, message = "Created successfully") => {
  return {
    code: 201,
    status: "Created",
    message,
    data,
  };
};

export const paginatedResponse = (data, pagination = {}) => {
  return {
    code: 200,
    status: "Success",
    message: "Data retrieved successfully",
    data,
    meta: {
      pagination: {
        page: pagination.page || 1,
        per_page: pagination.per_page || 50,
        has_more: pagination.has_more || false,
      },
      total: pagination.total || data.length,
    },
  };
};