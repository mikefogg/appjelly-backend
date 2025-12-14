//
// Initialize any events we have
//
import { Mixpanel } from "mixpanel-react-native";

let mixpanel;

export const initTracking = async () => {
  try {
    // Initialize Mixpanel if token is available
    const mixpanelToken = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;
    if (mixpanelToken) {
      const trackAutomaticEvents = true;
      mixpanel = new Mixpanel(mixpanelToken, trackAutomaticEvents);
      // For dev, debug so we can see it
      if (__DEV__) mixpanel.setLoggingEnabled(true);
      mixpanel.init();
      if (__DEV__) console.log("[Tracking] Mixpanel initialized successfully");
    } else {
      console.log(
        "[Tracking] Mixpanel token not found, skipping Mixpanel initialization"
      );
    }
  } catch (error) {
    console.log("[Tracking] Error initializing tracking", { error });
  }
};

//
// Events
//

export const trackEvent = async ({ type, params = {} }) => {
  if (!type) return;

  try {
    if (!mixpanel) {
      console.log("[Tracking] Mixpanel not initialized yet, initializing");
      await initTracking();
    }
    // Ensure mixpanel is initialized before tracking
    if (mixpanel) {
      mixpanel.track(type, params);
    } else {
      console.log(
        "[Tracking] Mixpanel not initialized yet, skipping event:",
        type
      );
    }

    if (__DEV__)
      console.log(
        "[Tracking] --- Tracked Event: %s (%s)",
        type,
        JSON.stringify(params)
      );
  } catch (error) {
    console.log("[Tracking] Error tracking an event", { error, type, params });
  }
};

export const trackEventTimeStart = ({ type }) => {
  try {
    if (mixpanel) {
      mixpanel.timeEvent(type);
    } else {
      console.log(
        "[Tracking] Mixpanel not initialized yet, skipping timer start:",
        type
      );
    }
  } catch (error) {
    console.log("[Tracking] Error tracking starting a timer", { error });
  }
};

//
// User Management
// trackEvent

export const setUserValues = (params = {}) => {
  try {
    if (__DEV__)
      console.log(
        "[Tracking] --- Set User Values (%s)",
        JSON.stringify(params)
      );
    // Set any super properties we want
    if (mixpanel) {
      for (let key of Object.keys(params)) {
        mixpanel.getPeople().set(key.toLowerCase(), params[key]);
      }
    } else {
      console.log(
        "[Tracking] Mixpanel not initialized yet, skipping user values"
      );
    }
  } catch (error) {
    console.log("[Tracking] Error setting user values", { error });
  }
};

export const setUserValuesOnce = (params = {}) => {
  try {
    // Set any super properties we want
    if (mixpanel) {
      for (let key of Object.keys(params)) {
        mixpanel.getPeople().setOnce(key.toLowerCase(), params[key]);
      }
    } else {
      console.log(
        "[Tracking] Mixpanel not initialized yet, skipping user values once"
      );
    }
  } catch (error) {
    console.log("[Tracking] Error setting user values", { error });
  }
};

export const trackIdentity = ({ id }) => {
  if (!id) return;

  try {
    if (__DEV__) console.log("[Tracking] --- Tracking identity");
    // Set our id
    if (mixpanel) {
      mixpanel.identify(id);
    } else {
      console.log("[Tracking] Mixpanel not initialized yet, skipping identity");
    }
  } catch (error) {
    console.log("[Tracking] Error tracking identify", { error });
  }
};

export const trackLogin = ({ user }) => {
  if (!user) return;

  try {
    if (__DEV__) console.log("[Tracking] --- Tracking login");
    // Set our id
    if (mixpanel) {
      mixpanel.identify(user.id);
      // Set any user properties we want
      trackUserUpdate({ user });
    } else {
      console.log("[Tracking] Mixpanel not initialized yet, skipping login");
    }
  } catch (error) {
    console.log("[Tracking] Error logging in", { error });
  }
};

export const trackLogout = () => {
  try {
    // Set our id
    if (mixpanel) {
      mixpanel.reset();
    } else {
      console.log("[Tracking] Mixpanel not initialized yet, skipping logout");
    }
  } catch (error) {
    console.log("[Tracking] Error logging out", { error });
  }
};

export const trackUserUpdate = ({ user }) => {
  if (!user) return;

  try {
    setUserValues({
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
    });
  } catch (error) {
    console.log("[Tracking] Error logging out", { error });
  }
};

//
// Super Properties (sent with EVERY event)
//

export const setSuperProperties = (params) => {
  try {
    if (mixpanel) {
      mixpanel.registerSuperProperties(params);
    } else {
      console.log(
        "[Tracking] Mixpanel not initialized yet, skipping super properties"
      );
    }
  } catch (error) {
    console.log("[Tracking] Error setting super properties", { error });
  }
};

export const unsetSuperProperties = (keys = []) => {
  try {
    if (mixpanel) {
      for (let key of keys) {
        mixpanel.unregisterSuperProperty(key);
      }
    } else {
      console.log(
        "[Tracking] Mixpanel not initialized yet, skipping unset super properties"
      );
    }
  } catch (error) {
    console.log("[Tracking] Error unsetting super properties", { error });
  }
};
