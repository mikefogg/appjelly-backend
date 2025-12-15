/**
 * AI Cost Tracking Helper
 * Tracks AI usage and costs to Mixpanel
 */
import { trackEvent } from "#src/helpers/track.js";

// Pricing per 1M tokens (updated Dec 2024)
const AI_PRICING = {
  "gpt-4o-mini": {
    input: 0.15 / 1_000_000,   // $0.15 per 1M input tokens
    output: 0.60 / 1_000_000,  // $0.60 per 1M output tokens
  },
  "gpt-4.1": {
    input: 2.00 / 1_000_000,   // $2.00 per 1M input tokens
    output: 8.00 / 1_000_000,  // $8.00 per 1M output tokens
  },
  "gpt-4.1-mini": {
    input: 0.40 / 1_000_000,   // $0.40 per 1M input tokens
    output: 1.60 / 1_000_000,  // $1.60 per 1M output tokens
  },
  // Fallback for unknown models
  "default": {
    input: 1.00 / 1_000_000,
    output: 4.00 / 1_000_000,
  },
};

/**
 * Calculate cost from token usage
 * @param {string} model - Model name
 * @param {number} inputTokens - Number of input/prompt tokens
 * @param {number} outputTokens - Number of output/completion tokens
 * @returns {number} Cost in USD
 */
export const calculateCost = (model, inputTokens, outputTokens) => {
  const pricing = AI_PRICING[model] || AI_PRICING["default"];
  return (inputTokens * pricing.input) + (outputTokens * pricing.output);
};

/**
 * Track AI usage event to Mixpanel
 *
 * @param {string} accountId - Account ID (distinct_id for Mixpanel)
 * @param {Object} options
 * @param {string} options.operation - Operation type: "voice_profile", "suggestions", "post_generate", "post_improve", "voice_analysis", "topic_extraction"
 * @param {string} options.model - Model used (e.g., "gpt-4o-mini")
 * @param {number} options.inputTokens - Number of input/prompt tokens
 * @param {number} options.outputTokens - Number of output/completion tokens
 * @param {number} options.durationMs - Time taken for the API call in milliseconds
 * @param {string} options.connectedAccountId - Connected account ID (optional)
 * @param {boolean} options.isFreeUser - Whether this is a free user (no subscription)
 * @param {Object} options.metadata - Additional metadata (optional)
 * @returns {Object} { cost, inputTokens, outputTokens } for adding to other events
 */
export const trackAICost = (accountId, {
  operation,
  model,
  inputTokens,
  outputTokens,
  durationMs,
  connectedAccountId = null,
  isFreeUser = false,
  metadata = {},
}) => {
  const cost = calculateCost(model, inputTokens, outputTokens);

  trackEvent(accountId, "AI Usage", {
    // Operation info
    operation,
    model,

    // Token usage
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,

    // Cost
    cost_usd: cost,
    cost_usd_millicents: Math.round(cost * 100000), // For easier aggregation (avoid float issues)

    // Performance
    duration_ms: durationMs,
    tokens_per_second: durationMs > 0 ? Math.round((inputTokens + outputTokens) / (durationMs / 1000)) : null,

    // Context
    connected_account_id: connectedAccountId,
    is_free_user: isFreeUser,

    // Additional metadata
    ...metadata,
  });

  // Return data for adding to other events
  return {
    ai_cost_usd: cost,
    ai_input_tokens: inputTokens,
    ai_output_tokens: outputTokens,
    ai_total_tokens: inputTokens + outputTokens,
    ai_duration_ms: durationMs,
    ai_model: model,
  };
};

/**
 * Extract usage from OpenAI response
 * @param {Object} response - OpenAI API response
 * @returns {Object} { inputTokens, outputTokens, totalTokens }
 */
export const extractUsage = (response) => {
  const usage = response?.usage || {};
  return {
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  };
};

export default {
  calculateCost,
  trackAICost,
  extractUsage,
  AI_PRICING,
};
