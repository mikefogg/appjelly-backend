/**
 * Sync Subscription Status Job
 * Fetches current subscription status from RevenueCat API and updates our database
 * Triggered when user opens app and RC SDK reports they're subscribed
 */

import SubscriptionService from "#src/helpers/subscription-service.js";

export const JOB_SYNC_SUBSCRIPTION_STATUS = "sync-subscription-status";

export default async function syncSubscriptionStatus(job) {
  const { rcCustomerId, accountId, appId } = job.data;

  console.log(`[Sync Subscription] Starting for customer: ${rcCustomerId}`);

  try {
    const result = await SubscriptionService.syncSubscriptionStatus(
      rcCustomerId,
      accountId,
      appId
    );

    console.log(`[Sync Subscription] Completed: ${result.synced} synced`);

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    console.error(`[Sync Subscription] Error:`, error);
    throw error;
  }
}
