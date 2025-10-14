/**
 * Fetch Mocking Helper for Test Suite
 *
 * Provides a clean, chainable API for mocking fetch calls in tests.
 * Supports both Solana RPC method-based mocking and general URL-based mocking.
 *
 * @example
 * // RPC method mocking
 * mockFetch
 *   .mockRpcMethod('getBalance', mockSolanaRpcGetBalance(wallet, balance))
 *   .mockRpcMethod('getBlocks', mockSolanaRpcGetBlocks(startSlot, numBlocks))
 *
 * // URL-based mocking
 * mockFetch
 *   .mockUrl('https://api.coingecko.com/api/v3/simple/price', priceData)
 *   .mockUrlPattern(/quote-api\.jup\.ag/, jupiterResponse)
 *
 * // Error scenarios
 * mockFetch.mockRpcMethodError('getBalance', 'RPC timeout')
 * mockFetch.mockUrlError('https://failing-service.com', 'Network error')
 *
 * // Assertions
 * expect(mockFetch).toHaveBeenCalledWithRpcMethod('getBalance')
 * expect(mockFetch).toHaveBeenCalledWithUrl('https://api.coingecko.com/api/v3/simple/price')
 */

import { vi } from "vitest";
import { quietLog } from "#src/utils/log.js";

class FetchMocker {
  constructor() {
    this.matchers = [];
    this.callHistory = [];
    this.originalFetch = global.fetch;
    this.setup();
  }

  /**
   * Initialize the global fetch mock
   */
  setup() {
    global.fetch = vi.fn().mockImplementation((url, options = {}) => {
      quietLog("[FetchMocker] Making external call to %s (%o)", url, options);

      // Record the call for assertions
      this.callHistory.push({ url, options });

      // Find matching rule
      const matcher = this.findMatcher(url, options);

      if (matcher) {
        if (matcher.error) {
          return Promise.reject(new Error(matcher.error));
        }
        return Promise.resolve(matcher.response);
      }

      // Default response for unmocked calls
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({ error: "Fetch call not mocked", url, options }),
      });
    });

    return this;
  }

  /**
   * Find the first matcher that matches the request and remove it
   */
  findMatcher(url, options) {
    for (let i = 0; i < this.matchers.length; i++) {
      const matcher = this.matchers[i];
      if (this.matchesRequest(matcher, url, options)) {
        // Handle sequence responses (multiple responses for same matcher)
        if (matcher.responseSequence && matcher.responseSequence.length > 0) {
          const response = matcher.responseSequence.shift();
          quietLog(
            `[mockFetch] Using sequence response for ${
              matcher.type === "rpc-method"
                ? `RPC method "${matcher.method}"`
                : `URL "${matcher.url}"`
            }, ${
              matcher.responseSequence.length
            } responses remaining in sequence`
          );

          // If sequence is empty, remove the matcher entirely
          if (matcher.responseSequence.length === 0) {
            this.matchers.splice(i, 1);
            quietLog(
              `[mockFetch] Sequence exhausted, removed matcher. ${this.matchers.length} matchers remaining`
            );
          }
          return { ...matcher, response };
        }

        // Remove the matcher after using it (queue-like behavior)
        this.matchers.splice(i, 1);
        const matcherDesc =
          matcher.type === "rpc-method"
            ? `RPC method "${matcher.method}"`
            : `URL "${matcher.url || matcher.pattern}"`;
        quietLog(
          `[mockFetch] Used and removed matcher for ${matcherDesc}. ${this.matchers.length} matchers remaining`
        );
        return matcher;
      }
    }

    quietLog(`[mockFetch] No matcher found for request`);
    return null;
  }

  /**
   * Check if a matcher matches the current request
   */
  matchesRequest(matcher, url, options) {
    switch (matcher.type) {
      case "rpc-method":
        return this.matchesRpcMethod(matcher, url, options);
      case "url":
        return this.matchesUrl(matcher, url, options);
      case "url-pattern":
        return this.matchesUrlPattern(matcher, url, options);
      default:
        return false;
    }
  }

  /**
   * Check if request matches an RPC method matcher
   */
  matchesRpcMethod(matcher, url, options) {
    try {
      if (!options.body) return false;
      const body = JSON.parse(options.body);
      return body.method === matcher.method;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if request matches a URL matcher
   */
  matchesUrl(matcher, url, options) {
    const methodMatches =
      matcher.httpMethod === "any" ||
      (options.method || "GET").toLowerCase() ===
        matcher.httpMethod.toLowerCase();

    const urlMatches =
      typeof matcher.url === "string"
        ? this.matchesUrlString(matcher.url, url)
        : matcher.url.test(url);

    return methodMatches && urlMatches;
  }

  /**
   * Check if request matches a URL pattern matcher
   */
  matchesUrlPattern(matcher, url, options) {
    const methodMatches =
      matcher.httpMethod === "any" ||
      (options.method || "GET").toLowerCase() ===
        matcher.httpMethod.toLowerCase();

    return methodMatches && matcher.pattern.test(url);
  }

  /**
   * Match URL strings with wildcard support
   */
  matchesUrlString(pattern, url) {
    if (pattern === url) return true;

    // Convert wildcard pattern to regex
    if (pattern.includes("*")) {
      const regexPattern = pattern
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // Escape regex chars
        .replace(/\\\*/g, ".*"); // Convert * to .*
      return new RegExp(`^${regexPattern}$`).test(url);
    }

    return false;
  }

  /**
   * Wrap response data in proper fetch response format
   */
  wrapResponse(data, options = {}) {
    const { status = 200, ok = true, headers = {} } = options;

    return {
      ok,
      status,
      headers,
      json: () => Promise.resolve(data),
      text: () =>
        Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)),
    };
  }

  // =============================================================================
  // PUBLIC API - RPC METHOD MOCKING
  // =============================================================================

  /**
   * Mock a Solana RPC method call
   * @param {string} method - RPC method name (e.g., 'getBalance', 'getBlocks')
   * @param {object} responseData - Response data to return
   * @param {object} options - Response options (status, ok, headers)
   */
  mockRpcMethod(method, responseData, options = {}) {
    this.matchers.push({
      type: "rpc-method",
      method,
      response: this.wrapResponse(responseData, options),
      error: null,
    });
    return this;
  }

  /**
   * Mock a Solana RPC method to return an error
   * @param {string} method - RPC method name
   * @param {string} errorMessage - Error message to throw
   */
  mockRpcMethodError(method, errorMessage) {
    this.matchers.push({
      type: "rpc-method",
      method,
      response: null,
      error: errorMessage,
    });
    return this;
  }

  /**
   * Mock a Solana RPC method with a sequence of responses
   * @param {string} method - RPC method name
   * @param {array} responseSequence - Array of response data for sequential calls
   * @param {object} options - Response options
   */
  mockRpcMethodSequence(method, responseSequence, options = {}) {
    this.matchers.push({
      type: "rpc-method",
      method,
      response: null,
      responseSequence: responseSequence.map((data) =>
        this.wrapResponse(data, options)
      ),
      error: null,
    });
    return this;
  }

  // =============================================================================
  // PUBLIC API - URL-BASED MOCKING
  // =============================================================================

  /**
   * Mock a specific URL
   * @param {string} url - URL to mock (supports wildcards with *)
   * @param {object} responseData - Response data to return
   * @param {string} httpMethod - HTTP method to match ('GET', 'POST', etc., or 'any')
   * @param {object} options - Response options
   */
  mockUrl(url, responseData, httpMethod = "any", options = {}) {
    this.matchers.push({
      type: "url",
      url,
      httpMethod,
      response: this.wrapResponse(responseData, options),
      error: null,
    });
    return this;
  }

  /**
   * Mock a URL pattern using regex
   * @param {RegExp} pattern - Regex pattern to match URLs
   * @param {object} responseData - Response data to return
   * @param {string} httpMethod - HTTP method to match
   * @param {object} options - Response options
   */
  mockUrlPattern(pattern, responseData, httpMethod = "any", options = {}) {
    this.matchers.push({
      type: "url-pattern",
      pattern,
      httpMethod,
      response: this.wrapResponse(responseData, options),
      error: null,
    });
    return this;
  }

  /**
   * Mock a URL to return an error
   * @param {string|RegExp} urlOrPattern - URL or pattern to mock
   * @param {string} errorMessage - Error message to throw
   * @param {string} httpMethod - HTTP method to match
   */
  mockUrlError(urlOrPattern, errorMessage, httpMethod = "any") {
    const type = urlOrPattern instanceof RegExp ? "url-pattern" : "url";
    const matcherKey = type === "url-pattern" ? "pattern" : "url";

    this.matchers.push({
      type,
      [matcherKey]: urlOrPattern,
      httpMethod,
      response: null,
      error: errorMessage,
    });
    return this;
  }

  // =============================================================================
  // PUBLIC API - UTILITIES
  // =============================================================================

  /**
   * Reset all mocks and call history
   */
  reset() {
    this.matchers = [];
    this.callHistory = [];
    if (global.fetch && global.fetch.mockClear) {
      global.fetch.mockClear();
    }
    return this;
  }

  /**
   * Restore original fetch implementation
   */
  restore() {
    if (this.originalFetch) {
      global.fetch = this.originalFetch;
    }
    this.reset();
    return this;
  }

  /**
   * Get all recorded fetch calls
   */
  getCalls() {
    return [...this.callHistory];
  }

  /**
   * Get calls that match a specific RPC method
   */
  getCallsForRpcMethod(method) {
    return this.callHistory.filter((call) => {
      try {
        if (!call.options.body) return false;
        const body = JSON.parse(call.options.body);
        return body.method === method;
      } catch (e) {
        return false;
      }
    });
  }

  /**
   * Get calls that match a specific URL
   */
  getCallsForUrl(url) {
    return this.callHistory.filter((call) => call.url === url);
  }

  // =============================================================================
  // PUBLIC API - ASSERTIONS
  // =============================================================================

  /**
   * Check if a specific RPC method was called
   */
  toHaveBeenCalledWithRpcMethod(method) {
    const calls = this.getCallsForRpcMethod(method);
    return {
      pass: calls.length > 0,
      message: () =>
        calls.length > 0
          ? `Expected RPC method "${method}" not to have been called, but it was called ${calls.length} time(s)`
          : `Expected RPC method "${method}" to have been called, but it wasn't`,
    };
  }

  /**
   * Check if a specific URL was called
   */
  toHaveBeenCalledWithUrl(url) {
    const calls = this.getCallsForUrl(url);
    return {
      pass: calls.length > 0,
      message: () =>
        calls.length > 0
          ? `Expected URL "${url}" not to have been called, but it was called ${calls.length} time(s)`
          : `Expected URL "${url}" to have been called, but it wasn't`,
    };
  }

  /**
   * Check total number of fetch calls made
   */
  toHaveBeenCalledTimes(expectedCount) {
    const actualCount = this.callHistory.length;
    return {
      pass: actualCount === expectedCount,
      message: () =>
        `Expected fetch to have been called ${expectedCount} time(s), but it was called ${actualCount} time(s)`,
    };
  }
}

// Create singleton instance
const mockFetch = new FetchMocker();

// Add custom Jest matchers
if (typeof expect !== "undefined" && expect.extend) {
  expect.extend({
    toHaveBeenCalledWithRpcMethod(received, method) {
      return mockFetch.toHaveBeenCalledWithRpcMethod(method);
    },
    toHaveBeenCalledWithUrl(received, url) {
      return mockFetch.toHaveBeenCalledWithUrl(url);
    },
    toHaveBeenCalledTimes(received, count) {
      return mockFetch.toHaveBeenCalledTimes(count);
    },
  });
}

export default mockFetch;
export { FetchMocker };
