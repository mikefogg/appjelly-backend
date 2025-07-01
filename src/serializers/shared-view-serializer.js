export const sharedViewSerializer = (sharedView) => {
  return {
    token: sharedView.token,
    artifact_id: sharedView.artifact_id,
    permissions: sharedView.permissions,
    expires_at: sharedView.metadata?.expires_at,
    created_at: sharedView.created_at,
  };
};

export const claimCharacterSerializer = (result) => {
  return {
    success: result.success,
    character_id: result.character_id,
    message: result.message || "Character claimed successfully",
  };
};