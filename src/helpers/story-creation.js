import { Input, Artifact, ArtifactActor, Media, Actor } from "#src/models/index.js";
import { contentQueue, JOB_GENERATE_CONTENT } from "#src/background/queues/index.js";

/**
 * Create a story (input + artifact) with proper validation and setup
 * 
 * @param {Object} params - Story creation parameters
 * @param {string} params.accountId - Account ID creating the story
 * @param {string} params.appId - App ID
 * @param {string} params.prompt - Story prompt
 * @param {string[]} params.actorIds - Array of actor IDs
 * @param {string[]} params.mainCharacterIds - Array of main character IDs (subset of actorIds)
 * @param {Object} params.metadata - Additional metadata for input
 * @param {string} params.title - Story title (optional)
 * @param {string} params.uploadSessionId - Upload session ID for media (optional)
 * @param {Object} params.appConfig - App configuration
 * @param {Object} params.trx - Database transaction (optional)
 * @returns {Promise<{input: Input, artifact: Artifact}>}
 */
export async function createStory({
  accountId,
  appId,
  prompt,
  actorIds,
  mainCharacterIds = [],
  metadata = {},
  title,
  uploadSessionId,
  appConfig,
  trx
}) {
  // Verify all actors exist and are accessible
  // If we're in a transaction, use it to ensure we see any newly claimed actors
  const actorQuery = trx 
    ? Actor.query(trx)
    : Actor.query();
    
  const actors = await actorQuery
    .where((builder) => {
      builder
        .where("actors.account_id", accountId)
        .orWhereExists((subquery) => {
          subquery
            .select("*")
            .from("account_links")
            .whereRaw("account_links.linked_account_id = actors.account_id")
            .where("account_links.account_id", accountId)
            .where("account_links.app_id", appId)
            .where("account_links.status", "accepted");
        });
    })
    .where("actors.app_id", appId)
    .whereIn("actors.id", actorIds); // Only check the actors we're trying to use

  const accessibleActorIds = actors.map((actor) => actor.id);

  const invalidActorIds = actorIds.filter(
    (id) => !accessibleActorIds.includes(id)
  );
  if (invalidActorIds.length > 0) {
    throw new Error("One or more actors not found");
  }

  // Verify main character IDs are subset of actor IDs
  const invalidMainCharacterIds = mainCharacterIds.filter(
    (id) => !actorIds.includes(id)
  );
  if (invalidMainCharacterIds.length > 0) {
    throw new Error("Main character IDs must be subset of actor IDs");
  }

  // Handle media session if provided
  let pendingMediaCount = 0;
  if (uploadSessionId) {
    const pendingMedia = await Media.findPendingBySessionId(uploadSessionId);
    
    if (pendingMedia.length === 0) {
      throw new Error("Upload session not found or expired");
    }

    // Verify ownership
    const hasAccess = pendingMedia.every(media => 
      media.metadata?.uploaded_by === accountId
    );

    if (!hasAccess) {
      throw new Error("Access denied to upload session");
    }

    pendingMediaCount = pendingMedia.length;

    // Check media limit (10 images per input)
    if (pendingMediaCount > 10) {
      throw new Error("Cannot commit more than 10 reference images to input");
    }
  }

  // Create story in transaction
  const createTransaction = async (transaction) => {
    const input = await Input.query(transaction).insert({
      account_id: accountId,
      app_id: appId,
      prompt,
      actor_ids: actorIds,
      metadata,
    });

    // Commit pending media if session provided
    if (uploadSessionId) {
      await Media.query(transaction)
        .where("upload_session_id", uploadSessionId)
        .where("status", "pending")
        .where("expires_at", ">", new Date().toISOString())
        .patch({
          owner_type: "input",
          owner_id: input.id,
          status: "committed",
          upload_session_id: null,
          expires_at: null,
        });
    }

    // Create initial artifact placeholder
    const artifact = await Artifact.query(transaction).insert({
      input_id: input.id,
      account_id: accountId,
      app_id: appId,
      artifact_type: appConfig?.default_artifact_type || "story",
      title: title || metadata.title || `Story - ${new Date().toLocaleDateString()}`,
      metadata: {
        status: "generating",
        started_at: new Date().toISOString(),
      },
    });

    // Set up actor relationships for the artifact
    if (actorIds.length > 0) {
      await ArtifactActor.setActorsForArtifact(artifact.id, actorIds, mainCharacterIds, transaction);
    }

    return { input, artifact };
  };

  // Use provided transaction or create new one
  const result = trx 
    ? await createTransaction(trx)
    : await Input.transaction(createTransaction);

  return result;
}

/**
 * Queue story generation job
 * 
 * @param {Object} params - Job parameters
 * @param {string} params.inputId - Input ID
 * @param {string} params.artifactId - Artifact ID  
 * @param {string} params.prompt - Story prompt
 * @param {string[]} params.actorIds - Actor IDs
 * @param {Object} params.appConfig - App configuration
 * @param {string} params.priority - Job priority ('normal', 'high')
 */
export async function queueStoryGeneration({
  inputId,
  artifactId,
  prompt,
  actorIds,
  appConfig,
  priority = 'normal'
}) {
  const jobPriority = priority === 'high' ? 10 : 5;
  
  await contentQueue.add(JOB_GENERATE_CONTENT, {
    inputId,
    artifactId,
    prompt,
    actorIds,
    appConfig,
    appSlug: appConfig?.slug, // Pass app slug for content routing
  }, {
    priority: jobPriority,
    delay: 1000, // Small delay to ensure DB writes are committed
  });
}