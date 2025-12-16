/**
 * File Type Handler Infrastructure for Git LFS Files
 *
 * This module provides an extensible system for handling different binary file types
 * stored in Git LFS. New file types can be added by implementing the LfsFileHandler
 * interface and registering the handler with the FileHandlerRegistry.
 */

import { Logger } from "../../utils/logger";

const logger = Logger.getInstance();

/**
 * Context information about the PR and file being viewed
 */
export interface PRContext {
	/** Pull Request ID */
	pullRequestId: number;
	/** Azure DevOps Project ID */
	projectId: string;
	/** Repository ID */
	repositoryId: string;
	/** Repository name (for display) */
	repositoryName?: string;
	/** File path in the repository */
	filePath: string;
	/** Commit SHA or branch name */
	version: string;
}

/**
 * Interface for handling specific file types in Git LFS
 *
 * Implement this interface to add support for new binary file types.
 * Each handler is responsible for:
 * 1. Determining if it can handle a given file (canHandle)
 * 2. Displaying the file in VS Code (displayFile)
 * 3. Providing the MIME type for the file (getMimeType)
 *
 * Example:
 * ```typescript
 * class ExcelFileHandler implements LfsFileHandler {
 *     canHandle(filePath: string): boolean {
 *         return /\.(xlsx?|csv)$/i.test(filePath);
 *     }
 *
 *     async displayFile(fileContent: Buffer, filePath: string, prContext: PRContext): Promise<void> {
 *         // Implementation to display Excel file
 *     }
 *
 *     getMimeType(filePath: string): string {
 *         return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 *     }
 * }
 * ```
 */
export interface LfsFileHandler {
	/**
	 * Determine if this handler can handle the given file
	 * @param filePath The file path (used to check extension)
	 * @param mimeType Optional MIME type hint
	 * @returns true if this handler can display this file type
	 */
	canHandle(filePath: string, mimeType?: string): boolean;

	/**
	 * Display the file content in VS Code
	 * @param fileContent The binary file content as a Buffer
	 * @param filePath The file path (for display and extension detection)
	 * @param prContext Context about the PR and file
	 * @throws Error if display fails
	 */
	displayFile(fileContent: Buffer, filePath: string, prContext: PRContext): Promise<void>;

	/**
	 * Get the MIME type for this file type
	 * @param filePath The file path (used for extension-based detection)
	 * @returns The MIME type string (e.g., 'application/pdf')
	 */
	getMimeType(filePath: string): string;

	/**
	 * Optional cleanup method called when the handler is disposed
	 * Use this to clean up temp files, close resources, etc.
	 */
	dispose?(): void;
}

/**
 * Registry for managing file type handlers
 *
 * This class maintains a collection of LfsFileHandler instances and provides
 * methods to register new handlers and find the appropriate handler for a file.
 *
 * Handlers are checked in registration order, so register more specific handlers
 * before more general ones.
 *
 * Example usage:
 * ```typescript
 * const registry = new FileHandlerRegistry();
 * registry.register(new PdfFileHandler());
 * registry.register(new ImageFileHandler());
 * registry.register(new FallbackBinaryHandler()); // Catch-all at end
 *
 * const handler = registry.getHandler('document.pdf');
 * if (handler) {
 *     await handler.displayFile(buffer, 'document.pdf', prContext);
 * }
 * ```
 */
export class FileHandlerRegistry {
	private handlers: LfsFileHandler[] = [];

	/**
	 * Register a new file type handler
	 * @param handler The handler to register
	 *
	 * Handlers are checked in registration order. Register more specific
	 * handlers (like PdfFileHandler) before generic ones (like FallbackBinaryHandler).
	 */
	register(handler: LfsFileHandler): void {
		this.handlers.push(handler);
	}

	/**
	 * Get the appropriate handler for a file
	 * @param filePath The file path to find a handler for
	 * @param mimeType Optional MIME type hint
	 * @returns The first handler that can handle this file, or undefined if none found
	 *
	 * Handlers are checked in registration order. The first handler that
	 * returns true from canHandle() will be returned.
	 */
	getHandler(filePath: string, mimeType?: string): LfsFileHandler | undefined {
		return this.handlers.find((handler) => handler.canHandle(filePath, mimeType));
	}

	/**
	 * Get all registered handlers
	 * @returns Array of all registered handlers
	 */
	getAllHandlers(): LfsFileHandler[] {
		return [...this.handlers];
	}

	/**
	 * Remove all registered handlers
	 * Useful for testing or reinitializing the registry
	 */
	clear(): void {
		// Dispose all handlers that implement dispose
		for (const handler of this.handlers) {
			if (handler.dispose) {
				try {
					handler.dispose();
				} catch (error) {
					logger.error("FileHandlerRegistry: Error disposing handler", error);
				}
			}
		}
		this.handlers = [];
	}

	/**
	 * Cleanup method called when the extension is deactivated
	 * Disposes all handlers that implement the dispose method
	 */
	dispose(): void {
		this.clear();
	}
}
