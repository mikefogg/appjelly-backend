//
// Shared constants for tracking all events
// All event names should be snake_case for consistency
//

// App States
export const APP_OPEN = 'app_opened';
export const APP_BACKGROUND = 'app_sent_to_background';
export const APP_RESUME = 'app_resumed';

// Backend Events
export const EVENTS = {
  // User/Auth
  CLERK_USER_CREATED: 'clerk_user_created',

  // AI
  AI_USAGE: 'ai_usage',

  // Voice Profile
  VOICE_PROFILE_GENERATED: 'voice_profile_generated',

  // Suggestions
  SUGGESTIONS_GENERATED: 'suggestions_generated',
  SUGGESTIONS_AUTO_GENERATED: 'suggestions_auto_generated',

  // Network
  NETWORK_SYNC_COMPLETED: 'network_sync_completed',

  // Subscriptions
  SUBSCRIPTION_TRANSFER_RECEIVED: 'subscription_transfer_received',
  SUBSCRIPTION_TRANSFER_SENT: 'subscription_transfer_sent',

  // Push Notifications
  PUSH_NOTIFICATION_SENT: 'push_notification_sent',
  PUSH_NOTIFICATION_FAILED: 'push_notification_failed',
};
