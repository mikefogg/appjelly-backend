import Account from "#src/models/Account.js";
import { sendPushNotification } from "#src/services/push-notifications/onesignal.js";
import { trackEvent } from "#src/helpers/track.js";
import { EVENTS } from "#src/utils/constants.js";

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
    // Look up account to check notification preferences
    const account = await Account.query().findById(account_id);

    if (!account) {
      return {
        success: false,
        error: "Account not found",
      };
    }

    // Check if notifications are enabled
    if (!account.notifications_enabled) {
      return {
        success: false,
        skipped: true,
        reason: "Notifications disabled by user",
      };
    }

    // Send the push notification using account ID as external user ID
    const result = await sendPushNotification(account_id, notification);

    // Track successful push
    trackEvent(account_id, EVENTS.PUSH_NOTIFICATION_SENT, {
      notification_type: notification.data?.type || "unknown",
      heading: notification.heading,
      recipients: result.recipients,
    });

    return {
      success: true,
      notification_id: result.notification_id,
      recipients: result.recipients,
    };
  } catch (error) {
    // Track failed push
    trackEvent(account_id, EVENTS.PUSH_NOTIFICATION_FAILED, {
      notification_type: notification.data?.type || "unknown",
      heading: notification.heading,
      error: error.message,
    });

    throw error; // Let BullMQ handle retries
  }
}
