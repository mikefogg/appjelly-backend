import Account from "#src/models/Account.js";
import { sendPushNotification } from "#src/services/push-notifications/onesignal.js";

/**
 * Background job to send push notifications via OneSignal
 * Uses external user ID (alias) to target users by account ID
 * @param {Object} job - BullMQ job
 * @param {string} job.data.account_id - Account ID to send notification to
 * @param {Object} job.data.notification - Notification data
 * @param {string} job.data.notification.heading - Notification title
 * @param {string} job.data.notification.content - Notification body
 * @param {Object} job.data.notification.data - Custom data payload
 */
export default async function sendPushNotificationJob(job) {
  const { account_id, notification } = job.data;

  try {
    console.log(`[Send Push Notification] Processing notification for account ${account_id}`);

    // Look up account to check notification preferences
    const account = await Account.query().findById(account_id);

    if (!account) {
      console.warn(`[Send Push Notification] Account ${account_id} not found`);
      return {
        success: false,
        error: "Account not found",
      };
    }

    // Check if notifications are enabled
    if (!account.notifications_enabled) {
      console.log(`[Send Push Notification] Notifications disabled for account ${account_id}`);
      return {
        success: false,
        skipped: true,
        reason: "Notifications disabled by user",
      };
    }

    // Send the push notification using account ID as external user ID
    const result = await sendPushNotification(account_id, notification);

    console.log(`[Send Push Notification] Successfully sent notification to account ${account_id}:`, {
      notification_id: result.notification_id,
      recipients: result.recipients,
    });

    return {
      success: true,
      notification_id: result.notification_id,
      recipients: result.recipients,
    };
  } catch (error) {
    console.error(`[Send Push Notification] Failed to send notification for account ${account_id}:`, error);
    throw error; // Let BullMQ handle retries
  }
}
