/**
 * OneSignal Push Notification Service
 * Sends push notifications to users via OneSignal
 */

import * as OneSignal from "@onesignal/node-onesignal";

// Initialize OneSignal client
const configuration = OneSignal.createConfiguration({
  restApiKey: process.env.ONESIGNAL_REST_API_KEY,
});

const client = new OneSignal.DefaultApi(configuration);

/**
 * Send a push notification to a specific user
 * @param {string} accountId - Account ID (used as external user ID alias)
 * @param {Object} notification - Notification data
 * @param {string} notification.heading - Notification title
 * @param {string} notification.content - Notification body
 * @param {Object} notification.data - Custom data payload
 * @returns {Promise<Object>} OneSignal API response
 */
export const sendPushNotification = async (accountId, notification) => {
  if (!process.env.ONESIGNAL_APP_ID) {
    throw new Error("ONESIGNAL_APP_ID environment variable is not set");
  }

  if (!process.env.ONESIGNAL_REST_API_KEY) {
    throw new Error("ONESIGNAL_REST_API_KEY environment variable is not set");
  }

  try {
    const { heading, content, data = {} } = notification;

    const notificationBody = new OneSignal.Notification();
    notificationBody.app_id = process.env.ONESIGNAL_APP_ID;

    // Target specific user by external user ID (alias)
    notificationBody.include_aliases = {
      external_id: [accountId]
    };
    notificationBody.target_channel = "push";

    // Notification content
    notificationBody.headings = { en: heading };
    notificationBody.contents = { en: content };

    // Custom data payload
    if (Object.keys(data).length > 0) {
      notificationBody.data = data;
    }

    // Send notification
    const response = await client.createNotification(notificationBody);

    // Check for errors in response (OneSignal returns partial success/errors)
    if (response.errors) {
      console.warn(`[OneSignal] Notification sent with errors for account ${accountId}:`, response.errors);

      // Check if alias is invalid (user hasn't registered with OneSignal yet)
      if (response.errors.invalid_aliases) {
        throw new Error(`User has not registered with OneSignal yet. Frontend must call OneSignal.login("${accountId}") first.`);
      }
    }

    console.log(`[OneSignal] Sent notification to account ${accountId}:`, {
      id: response.id,
      recipients: response.recipients,
    });

    return {
      success: true,
      notification_id: response.id,
      recipients: response.recipients,
    };
  } catch (error) {
    console.error(`[OneSignal] Failed to send notification:`, error);
    throw new Error(`OneSignal API error: ${error.message}`);
  }
};

/**
 * Send a push notification to multiple users
 * @param {string[]} accountIds - Array of account IDs (used as external user ID aliases)
 * @param {Object} notification - Notification data
 * @returns {Promise<Object>} OneSignal API response
 */
export const sendPushNotificationToMultiple = async (accountIds, notification) => {
  if (!process.env.ONESIGNAL_APP_ID) {
    throw new Error("ONESIGNAL_APP_ID environment variable is not set");
  }

  if (!process.env.ONESIGNAL_REST_API_KEY) {
    throw new Error("ONESIGNAL_REST_API_KEY environment variable is not set");
  }

  if (!accountIds || accountIds.length === 0) {
    throw new Error("No account IDs provided");
  }

  try {
    const { heading, content, data = {} } = notification;

    const notificationBody = new OneSignal.Notification();
    notificationBody.app_id = process.env.ONESIGNAL_APP_ID;

    // Target multiple users by external user IDs (aliases)
    notificationBody.include_aliases = {
      external_id: accountIds
    };
    notificationBody.target_channel = "push";

    // Notification content
    notificationBody.headings = { en: heading };
    notificationBody.contents = { en: content };

    // Custom data payload
    if (Object.keys(data).length > 0) {
      notificationBody.data = data;
    }

    // Send notification
    const response = await client.createNotification(notificationBody);

    // Check for errors in response (OneSignal returns partial success/errors)
    if (response.errors) {
      console.warn(`[OneSignal] Notification sent with errors:`, response.errors);

      // Check if some aliases are invalid
      if (response.errors.invalid_aliases) {
        console.warn(`[OneSignal] Invalid aliases (users not registered):`, response.errors.invalid_aliases.external_id);
      }
    }

    console.log(`[OneSignal] Sent notification to ${accountIds.length} users:`, {
      id: response.id,
      recipients: response.recipients,
    });

    return {
      success: true,
      notification_id: response.id,
      recipients: response.recipients,
    };
  } catch (error) {
    console.error(`[OneSignal] Failed to send notification:`, error);
    throw new Error(`OneSignal API error: ${error.message}`);
  }
};

export default {
  sendPushNotification,
  sendPushNotificationToMultiple,
};
