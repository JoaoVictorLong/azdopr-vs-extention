import type * as vscode from "vscode";
import { COMMENT_DEBOUNCE_MS } from "../constants/cacheConfig";
import type { PRCommentController } from "../providers/prCommentController";
import { Logger } from "../utils/logger";
import { PRContextManager } from "./prContextManager";

const logger = Logger.getInstance();

/**
 * Event coordinator for comment loading
 * Prevents duplicate loads through debouncing and tracking
 * Handles cleanup when documents are closed
 */
export class CommentEventCoordinator {
	/** Debounce timers keyed by document URI */
	private readonly debounceTimers: Map<string, NodeJS.Timeout> = new Map();

	/** Track which documents have been loaded */
	private readonly loadedDocuments: Set<string> = new Set();

	/** Debounce delay in milliseconds */
	private readonly debounceMs: number = COMMENT_DEBOUNCE_MS;

	constructor(private readonly commentController: PRCommentController) {
		logger.debug("CommentEventCoordinator: Initialized");
	}

	/**
	 * Handle document open event
	 * Debounces to prevent duplicate loads when multiple events fire
	 */
	public async handleDocumentEvent(document: vscode.TextDocument): Promise<void> {
		if (document.uri.scheme !== "azdo-pr") {
			return;
		}

		const key = document.uri.toString();

		logger.debug(`CommentEventCoordinator: Document event for: ${document.uri.path}`);

		// Clear any existing debounce timer
		if (this.debounceTimers.has(key)) {
			clearTimeout(this.debounceTimers.get(key));
			this.debounceTimers.delete(key);
		}

		// Set up debounced load
		const timer = setTimeout(async () => {
			this.debounceTimers.delete(key);

			try {
				await this.commentController.loadCommentsForDocument(document);
				this.loadedDocuments.add(key);
			} catch (error) {
				logger.error("[CommentEventCoordinator] Error loading comments", error);
			}
		}, this.debounceMs);

		this.debounceTimers.set(key, timer);
	}

	/**
	 * Handle editor change event
	 * Only loads if document hasn't been loaded yet
	 */
	public async handleEditorChange(editor: vscode.TextEditor | undefined): Promise<void> {
		if (!editor || editor.document.uri.scheme !== "azdo-pr") {
			return;
		}

		const key = editor.document.uri.toString();

		// Skip if already loaded or currently being loaded
		if (this.loadedDocuments.has(key) || this.debounceTimers.has(key)) {
			logger.debug(
				`[CommentEventCoordinator] Skipping editor change - already loaded/loading: ${editor.document.uri.path}`,
			);
			return;
		}

		logger.debug(`CommentEventCoordinator: Editor change for: ${editor.document.uri.path}`);

		// Load comments
		await this.handleDocumentEvent(editor.document);
	}

	/**
	 * Handle document close event
	 * Cleans up resources for the closed document
	 */
	public handleDocumentClose(document: vscode.TextDocument): void {
		if (document.uri.scheme !== "azdo-pr") {
			return;
		}

		const key = document.uri.toString();

		logger.debug(`CommentEventCoordinator: Document closed: ${document.uri.path}`);

		// Clear debounce timer if exists
		if (this.debounceTimers.has(key)) {
			clearTimeout(this.debounceTimers.get(key));
			this.debounceTimers.delete(key);
		}

		// Remove from loaded set
		this.loadedDocuments.delete(key);

		// Clear comments for this document
		this.commentController.clearCommentsForDocument(document.uri);

		// Cleanup context
		try {
			PRContextManager.getInstance().clearFileContext(document.uri);
		} catch {
			logger.warn("[CommentEventCoordinator] Failed to clear context");
		}
	}

	/**
	 * Dispose of resources
	 */
	public dispose(): void {
		logger.debug("CommentEventCoordinator: Disposing");

		// Clear all debounce timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();
		this.loadedDocuments.clear();
	}
}
