/**
 * Migrate Caption Writer captions to Ghost as draft artifacts
 */

import { Artifact, ArtifactVersion, ConnectedAccount, knex } from "#src/models/index.js";

// Map CW network values to Ghost platform values
const CW_NETWORK_TO_PLATFORM = {
  instagram: "instagram",
  tiktok: "tiktok",
  facebook: "facebook",
  twitter: "twitter",
  threads: "threads",
  linkedin: "linkedin",
  youtube: "custom",
};

const PLATFORM_LABELS = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  twitter: "Twitter",
  threads: "Threads",
  linkedin: "LinkedIn",
  custom: "Custom",
};

const CHUNK_SIZE = 50;

/**
 * Migrate CW captions for a user to Ghost drafts
 * @param {Object} job - BullMQ job
 * @param {number} job.data.cwUserId - CW user ID
 * @param {string} job.data.ghostAccountId - Ghost account UUID
 * @param {string} job.data.ghostAppId - Ghost app UUID
 * @param {string} [job.data.forceConnectedAccountId] - Optional: force all captions to this connected account
 */
export default async function migrateCwCaptions(job) {
  const { cwUserId, ghostAccountId, ghostAppId, forceConnectedAccountId } = job.data;

  console.log(`[Migrate CW] Starting migration for CW user ${cwUserId} -> Ghost account ${ghostAccountId}`);

  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
    connectionsCreated: 0,
    errors: [],
  };

  // Cache for connected accounts by platform
  const connectionCache = new Map();

  // If forcing a specific connected account, validate and cache it
  if (forceConnectedAccountId) {
    const forcedConnection = await ConnectedAccount.query()
      .findById(forceConnectedAccountId)
      .where("account_id", ghostAccountId)
      .where("app_id", ghostAppId);

    if (!forcedConnection) {
      throw new Error(`Connected account ${forceConnectedAccountId} not found or doesn't belong to account`);
    }

    connectionCache.set("__forced__", forcedConnection);
    console.log(`[Migrate CW] Using forced connected account: ${forcedConnection.id} (${forcedConnection.platform})`);
  }

  // Get total count for progress tracking
  const totalResult = await knex("cw_captions")
    .where("user_id", cwUserId)
    .whereNull("migrated_at")
    .count("id as count")
    .first();
  const totalCount = parseInt(totalResult.count, 10);

  console.log(`[Migrate CW] Found ${totalCount} captions to migrate`);

  if (totalCount === 0) {
    return { ...results, message: "No captions to migrate" };
  }

  let processed = 0;

  while (true) {
    // Fetch chunk of captions with folder info
    // No offset needed - processed captions are excluded by whereNull("migrated_at")
    const captions = await knex("cw_captions as c")
      .leftJoin("cw_folders as f", "c.folder_id", "f.local_id")
      .where("c.user_id", cwUserId)
      .whereNull("c.migrated_at")
      .orderBy("c.created_at", "asc")
      .limit(CHUNK_SIZE)
      .select(
        "c.*",
        "f.name as folder_name",
        "f.folder_id as parent_folder_id"
      );

    if (captions.length === 0) break;

    // Build folder paths for this chunk
    const folderPaths = await buildFolderPaths(captions, cwUserId);

    for (const caption of captions) {
      try {
        // Skip if already migrated (double-check)
        if (caption.migrated_at) {
          results.skipped++;
          processed++;
          continue;
        }

        // Resolve connected account
        const connectedAccount = await resolveConnectedAccount(
          caption,
          ghostAccountId,
          ghostAppId,
          forceConnectedAccountId,
          connectionCache,
          results
        );

        // Build metadata
        const metadata = {
          source: "caption_writer",
          cw_caption_id: caption.id,
          cw_local_id: caption.local_id,
          cw_folder_id: caption.folder_id,
          cw_folder_name: caption.folder_name,
          cw_folder_path: folderPaths.get(caption.folder_id) || null,
          network: caption.network,
          network_placement: caption.network_placement,
          count_hashtags: caption.count_hashtags,
          count_characters: caption.count_characters,
          cw_created_at: caption.created_at,
          cw_updated_at: caption.updated_at,
          migrated_at: new Date().toISOString(),
          platform: connectedAccount.platform,
          mode: "standalone",
        };

        // Handle null timestamps - use current time as fallback
        const now = new Date().toISOString();
        if (!caption.created_at || !caption.updated_at) {
          console.log(`[Migrate CW] Caption ${caption.id} has null timestamp:`, {
            created_at: caption.created_at,
            updated_at: caption.updated_at,
            name: caption.name?.substring(0, 50),
          });
        }
        const createdAt = caption.created_at ? new Date(caption.created_at).toISOString() : now;
        const updatedAt = caption.updated_at ? new Date(caption.updated_at).toISOString() : now;

        // Create artifact
        const artifact = await Artifact.query().insert({
          account_id: ghostAccountId,
          app_id: ghostAppId,
          connected_account_id: connectedAccount.id,
          artifact_type: "social_post",
          status: "draft",
          title: caption.name || null,
          content: caption.content || "",
          current_version_number: 1,
          metadata,
          created_at: createdAt,
          updated_at: updatedAt,
        });

        // Create initial version
        await ArtifactVersion.query().insert({
          artifact_id: artifact.id,
          version_number: 1,
          content: caption.content || "",
          source_type: "creation",
          source_metadata: {
            imported_from: "caption_writer",
            cw_caption_id: caption.id,
          },
          created_at: createdAt,
        });

        // Mark caption as migrated
        await knex("cw_captions").where("id", caption.id).update({
          ghost_artifact_id: artifact.id,
          migrated_at: new Date().toISOString(),
        });

        results.success++;
      } catch (error) {
        console.error(`[Migrate CW] Failed to migrate caption ${caption.id}:`, error.message);

        // Record error on caption
        await knex("cw_captions").where("id", caption.id).update({
          migration_error: JSON.stringify({
            message: error.message,
            timestamp: new Date().toISOString(),
          }),
        });

        results.failed++;
        results.errors.push({ captionId: caption.id, error: error.message });
      }

      processed++;

      // Update progress
      const progress = Math.round((processed / totalCount) * 100);
      job.updateProgress(progress);
    }
  }

  console.log(`[Migrate CW] Migration complete:`, results);
  return results;
}

/**
 * Resolve or create connected account for a caption
 */
async function resolveConnectedAccount(caption, accountId, appId, forceConnectedAccountId, cache, results) {
  // If forcing a specific connected account, use it
  if (forceConnectedAccountId && cache.has("__forced__")) {
    return cache.get("__forced__");
  }

  // Map CW network to Ghost platform
  let platform = CW_NETWORK_TO_PLATFORM[caption.network?.toLowerCase()];
  if (!platform) {
    platform = "instagram"; // Default to Instagram
  }

  // Check cache
  if (cache.has(platform)) {
    return cache.get(platform);
  }

  // Find existing connected account for this platform
  let connection = await ConnectedAccount.query()
    .where("account_id", accountId)
    .where("app_id", appId)
    .where("platform", platform)
    .where("is_active", true)
    .orderBy("created_at", "asc")
    .first();

  // Create if doesn't exist
  if (!connection) {
    console.log(`[Migrate CW] Creating new connected account for platform: ${platform}`);

    connection = await ConnectedAccount.query().insert({
      account_id: accountId,
      app_id: appId,
      platform: platform,
      label: PLATFORM_LABELS[platform] || platform,
      is_active: true,
      sync_status: "ready",
      content_preferences: ConnectedAccount.getDefaultContentPreferences(platform),
    });

    results.connectionsCreated++;
  }

  // Cache for reuse
  cache.set(platform, connection);

  return connection;
}

/**
 * Build folder paths for captions that have folders
 */
async function buildFolderPaths(captions, cwUserId) {
  const folderIds = [...new Set(captions.map((c) => c.folder_id).filter(Boolean))];

  if (folderIds.length === 0) {
    return new Map();
  }

  // Fetch all folders for this user
  const allFolders = await knex("cw_folders").where("user_id", cwUserId);
  const folderByLocalId = new Map(allFolders.map((f) => [f.local_id, f]));

  const pathCache = new Map();

  function getPath(localId) {
    if (!localId) return null;
    if (pathCache.has(localId)) return pathCache.get(localId);

    const folder = folderByLocalId.get(localId);
    if (!folder) return null;

    const parentPath = folder.folder_id ? getPath(folder.folder_id) : null;
    const fullPath = parentPath ? `${parentPath}/${folder.name}` : folder.name;

    pathCache.set(localId, fullPath);
    return fullPath;
  }

  // Build paths for all needed folders
  folderIds.forEach((id) => getPath(id));

  return pathCache;
}
