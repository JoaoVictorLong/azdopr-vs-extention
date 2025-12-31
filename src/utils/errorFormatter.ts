/**
 * Error formatting utilities
 * Provides consistent error message formatting throughout the application
 */

/**
 * Format error for display to user
 * Handles both Error instances and non-Error thrown values
 *
 * @param error - The error to format (can be Error, string, or any thrown value)
 * @returns Formatted error message string
 *
 * @example
 * ```typescript
 * try {
 *   throw new Error("Something went wrong");
 * } catch (error) {
 *   const message = formatErrorMessage(error);
 *   console.error(message); // "Something went wrong"
 * }
 * ```
 */
export function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return `[Non-Error type thrown: ${typeof error}]`;
}

/**
 * Format error with prefix for user display
 * Useful for adding context to error messages
 *
 * @param prefix - The prefix to add before the error message
 * @param error - The error to format
 * @returns Formatted error message with prefix
 *
 * @example
 * ```typescript
 * try {
 *   await fetchData();
 * } catch (error) {
 *   const message = formatErrorWithPrefix("Failed to fetch data", error);
 *   vscode.window.showErrorMessage(message);
 *   // Displays: "Failed to fetch data: Connection timeout"
 * }
 * ```
 */
export function formatErrorWithPrefix(prefix: string, error: unknown): string {
	return `${prefix}: ${formatErrorMessage(error)}`;
}
