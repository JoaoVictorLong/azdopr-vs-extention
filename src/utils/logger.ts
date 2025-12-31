import * as vscode from "vscode";

/**
 * Logging levels for the extension
 */
export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
}

/**
 * Centralized logging service for the extension
 * Uses VS Code's Output Channel API for production-ready logging
 *
 * This class implements the Singleton pattern to ensure a single Output Channel
 * is shared across the entire extension, preventing multiple channel creation
 * and ensuring consistent log formatting.
 *
 * ## Usage Guidelines
 *
 * **Use Logger for:**
 * - Debug information (developer-facing, not shown to users by default)
 * - Informational messages about extension operations
 * - Warnings about potential issues
 * - Errors with detailed stack traces for debugging
 *
 * **Use vscode.window.showErrorMessage/showInformationMessage for:**
 * - User-facing notifications that require immediate attention
 * - Success confirmations for user actions
 * - Error messages that users need to see and understand
 *
 * **Best Practice:** Log to Logger first, then optionally show user notification
 *
 * @example
 * ```typescript
 * const logger = Logger.getInstance();
 *
 * // For debugging (developer-only, won't clutter user's screen)
 * logger.debug("Cache hit for PR #123");
 * logger.info("User signed in successfully");
 *
 * // For errors (log first, then notify user)
 * try {
 *   await fetchData();
 * } catch (error) {
 *   logger.error("Failed to fetch data", error); // Logs with stack trace
 *   vscode.window.showErrorMessage("Failed to fetch data"); // User notification
 * }
 * ```
 */
export class Logger {
	private static _instance: Logger | undefined;
	private outputChannel: vscode.OutputChannel;
	private logLevel: LogLevel = LogLevel.INFO;

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel("Azure DevOps PR Viewer");
	}

	/**
	 * Get the singleton instance of the logger
	 *
	 * The singleton pattern ensures:
	 * - Only one Output Channel is created for the entire extension
	 * - All logging goes to the same place for easier debugging
	 * - Consistent log formatting across all components
	 * - Shared log level configuration
	 *
	 * @returns The singleton Logger instance
	 */
	public static getInstance(): Logger {
		if (!Logger._instance) {
			Logger._instance = new Logger();
		}
		return Logger._instance;
	}

	/**
	 * Set the minimum log level
	 * Messages below this level will be ignored
	 */
	public setLogLevel(level: LogLevel): void {
		this.logLevel = level;
	}

	/**
	 * Show the output channel in the UI
	 */
	public show(): void {
		this.outputChannel.show();
	}

	/**
	 * Log a debug message (only in debug mode)
	 */
	public debug(message: string, ...args: unknown[]): void {
		if (this.logLevel <= LogLevel.DEBUG) {
			this.log("DEBUG", message, ...args);
		}
	}

	/**
	 * Log an informational message
	 */
	public info(message: string, ...args: unknown[]): void {
		if (this.logLevel <= LogLevel.INFO) {
			this.log("INFO", message, ...args);
		}
	}

	/**
	 * Log a warning message
	 */
	public warn(message: string, ...args: unknown[]): void {
		if (this.logLevel <= LogLevel.WARN) {
			this.log("WARN", message, ...args);
		}
	}

	/**
	 * Log an error message
	 */
	public error(message: string, error?: unknown): void {
		if (this.logLevel <= LogLevel.ERROR) {
			const errorDetails = error instanceof Error ? error.message : String(error);
			const stackTrace = error instanceof Error && error.stack ? `\n${error.stack}` : "";
			this.log("ERROR", `${message}: ${errorDetails}${stackTrace}`);
		}
	}

	/**
	 * Internal logging method
	 */
	private log(level: string, message: string, ...args: unknown[]): void {
		const timestamp = new Date().toISOString();
		const formattedArgs = args.length > 0 ? ` ${JSON.stringify(args)}` : "";
		this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}${formattedArgs}`);
	}

	/**
	 * Clear the output channel
	 */
	public clear(): void {
		this.outputChannel.clear();
	}

	/**
	 * Dispose of the logger
	 */
	public dispose(): void {
		this.outputChannel.dispose();
	}
}
