/**
 * Cache and refresh configuration constants
 * Centralized configuration for caching and refresh intervals
 */

/**
 * PR cache time-to-live in milliseconds (5 minutes)
 * Cached PR details will expire after this duration
 */
export const PR_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Cache cleanup interval in milliseconds (1 minute)
 * How often to run cleanup of expired cache entries
 */
export const CACHE_CLEANUP_INTERVAL_MS = 60 * 1000;

/**
 * Minimum interval between PR list refreshes in milliseconds (5 seconds)
 * Prevents refresh loops by limiting to once per interval
 */
export const MIN_REFRESH_INTERVAL_MS = 5000;

/**
 * Debounce delay for comment loading operations in milliseconds (50ms)
 * Prevents duplicate comment loads from rapid document open/switch events
 */
export const COMMENT_DEBOUNCE_MS = 50;
