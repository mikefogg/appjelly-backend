import Mixpanel from "mixpanel";

let mixpanel = null;

const getMixpanel = () => {
  if (!mixpanel && process.env.MIXPANEL_PROJECT_ID) {
    mixpanel = Mixpanel.init(process.env.MIXPANEL_PROJECT_ID, {
      protocol: "https",
    });
  }
  return mixpanel;
};

/**
 * Track an event for a specific account
 * @param {string} accountId - The account ID (used as distinct_id)
 * @param {string} eventName - Name of the event
 * @param {Object} properties - Event properties
 */
export const trackEvent = (accountId, eventName, properties = {}) => {
  const mp = getMixpanel();
  if (!mp) {
    if (process.env.NODE_ENV === "development") {
      console.log(`[Mixpanel] Skipped (no token): ${eventName}`, { accountId, ...properties });
    }
    return;
  }

  try {
    mp.track(eventName, {
      distinct_id: accountId,
      ...properties,
      tracked_at: new Date().toISOString(),
    });

    if (process.env.NODE_ENV === "development") {
      console.log(`[Mixpanel] Tracked: ${eventName}`, { accountId });
    }
  } catch (error) {
    console.error(`[Mixpanel] Error tracking ${eventName}:`, error.message);
  }
};

/**
 * Track an event for multiple accounts (e.g., transfers)
 * @param {string[]} accountIds - Array of account IDs
 * @param {string} eventName - Name of the event
 * @param {Object} properties - Event properties
 */
export const trackEventForAccounts = (accountIds, eventName, properties = {}) => {
  const validIds = accountIds.filter(Boolean);
  for (const accountId of validIds) {
    trackEvent(accountId, eventName, properties);
  }
};

/**
 * Set user profile properties
 * @param {string} accountId - The account ID
 * @param {Object} properties - Profile properties
 */
export const setUserProperties = (accountId, properties = {}) => {
  const mp = getMixpanel();
  if (!mp || !accountId) return;

  try {
    mp.people.set(accountId, {
      ...properties,
      last_updated: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[Mixpanel] Error setting user properties:`, error.message);
  }
};

export default {
  trackEvent,
  trackEventForAccounts,
  setUserProperties,
};
