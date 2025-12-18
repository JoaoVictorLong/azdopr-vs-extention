import * as vscode from "vscode";
import { THREAD_STATUS } from "../constants/azureDevOpsConstants";
import type { PRComment, PRThread } from "../services/azureDevOpsClient";
import { getThreadStatusLabel } from "../utils/commentFormatter";
import { Logger } from "../utils/logger";
import { AzDOComment, TemporaryComment } from "./comments";

const logger = Logger.getInstance();

/**
 * PR context information for comment threads
 */
export interface PRContext {
	projectId: string;
	repositoryId: string;
	pullRequestId: number;
}

/**
 * Extended comment thread with Azure DevOps specific properties
 * Tracks server thread ID and PR context
 */
export interface AzDOCommentThread extends vscode.CommentThread {
	/** Server thread ID */
	threadId: number;

	/** PR context for API calls */
	prContext: PRContext;

	/** Loading state */
	isLoading?: boolean;

	/** Comments array (typed for our comment classes) */
	comments: ReadonlyArray<AzDOComment | TemporaryComment>;
}

/**
 * Manager for comment threads
 * Handles creation, updates, and synchronization without unnecessary disposal
 */
export class CommentThreadManager {
	/** Map of thread key to thread */
	private readonly threads: Map<string, AzDOCommentThread> = new Map();

	/** VS Code comment controller */
	private readonly commentController: vscode.CommentController;

	constructor(commentController: vscode.CommentController) {
		this.commentController = commentController;
	}

	/**
	 * Generate a unique key for a thread
	 */
	private getThreadKey(uri: vscode.Uri, threadId: number): string {
		return `${uri.toString()}#${threadId}`;
	}

	/**
	 * Get all thread keys for a document
	 */
	public getThreadKeys(uri: vscode.Uri): string[] {
		const uriString = uri.toString();
		const keys: string[] = [];

		for (const key of this.threads.keys()) {
			if (key.startsWith(uriString)) {
				keys.push(key);
			}
		}

		return keys;
	}

	/**
	 * Get a thread by key
	 */
	public getThread(threadKey: string): AzDOCommentThread | undefined {
		return this.threads.get(threadKey);
	}

	/**
	 * Get or create a thread (no unnecessary disposal)
	 */
	public getOrCreateThread(
		document: vscode.TextDocument,
		range: vscode.Range,
		threadId: number,
		prContext: PRContext,
	): AzDOCommentThread {
		const threadKey = this.getThreadKey(document.uri, threadId);
		const existing = this.threads.get(threadKey);

		if (existing) {
			// Update range if it changed
			if (
				existing.range &&
				!existing.range.isEqual(range) &&
				range.start.line >= 0 &&
				range.start.line < document.lineCount
			) {
				existing.range = range;
			}
			return existing;
		}

		// Create new thread
		const thread = this.commentController.createCommentThread(
			document.uri,
			range,
			[],
		) as AzDOCommentThread;

		thread.threadId = threadId;
		thread.prContext = prContext;
		thread.canReply = true;
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;

		this.threads.set(threadKey, thread);

		logger.debug(`ThreadManager: Created new thread ${threadId} at line ${range.start.line + 1}`);

		return thread;
	}

	/**
	 * Update thread comments differentially
	 * Only updates if comments actually changed
	 */
	public updateThreadComments(
		thread: AzDOCommentThread,
		newServerComments: PRComment[],
		organizationUrl?: string,
		currentUserId?: string,
	): boolean {
		const existingComments = thread.comments as AzDOComment[];

		// Quick check: if counts differ, we definitely need to update
		if (existingComments.length !== newServerComments.length) {
			thread.comments = this.createComments(
				newServerComments,
				thread.threadId,
				thread,
				organizationUrl,
				currentUserId,
			);
			logger.debug(
				`[ThreadManager] Updated thread ${thread.threadId}: comment count changed ${existingComments.length} -> ${newServerComments.length}`,
			);
			return true;
		}

		// Check if any comments changed
		let hasChanges = false;
		const updatedComments: AzDOComment[] = [];

		for (let i = 0; i < newServerComments.length; i++) {
			const serverComment = newServerComments[i];
			const existingComment = existingComments[i];

			// If existing comment is temporary, create real one
			if (existingComment instanceof TemporaryComment) {
				updatedComments.push(
					new AzDOComment(serverComment, thread.threadId, thread, organizationUrl, currentUserId),
				);
				hasChanges = true;
				continue;
			}

			// Check if comment ID matches (order might have changed)
			if (existingComment.commentId !== serverComment.id) {
				// Different comment, recreate all
				thread.comments = this.createComments(
					newServerComments,
					thread.threadId,
					thread,
					organizationUrl,
					currentUserId,
				);
				logger.debug(`ThreadManager: Updated thread ${thread.threadId}: comment order changed`);
				return true;
			}

			// Update existing comment in place
			const changed = existingComment.update(serverComment);
			if (changed) {
				hasChanges = true;
			}
			updatedComments.push(existingComment);
		}

		if (hasChanges) {
			// Trigger UI update by reassigning array
			thread.comments = updatedComments;
			logger.debug(`ThreadManager: Updated thread ${thread.threadId}: content changed`);
		}

		return hasChanges;
	}

	/**
	 * Create comment objects from server data
	 */
	private createComments(
		serverComments: PRComment[],
		threadId: number,
		parent: vscode.CommentThread,
		organizationUrl?: string,
		currentUserId?: string,
	): AzDOComment[] {
		return serverComments.map(
			(comment) => new AzDOComment(comment, threadId, parent, organizationUrl, currentUserId),
		);
	}

	/**
	 * Get unique contributors from thread comments
	 * Returns a formatted string like "Participants: Alice, Bob, Charlie"
	 */
	private getThreadContributors(comments: PRComment[]): string {
		if (comments.length === 0) {
			return "";
		}

		// Get unique author display names
		const uniqueAuthors = new Set<string>();
		for (const comment of comments) {
			uniqueAuthors.add(comment.author.displayName);
		}

		// Convert to array and join
		const authors = Array.from(uniqueAuthors);

		// Format based on count
		let authorList: string;
		if (authors.length === 1) {
			authorList = authors[0];
		} else if (authors.length === 2) {
			authorList = `${authors[0]} and ${authors[1]}`;
		} else if (authors.length <= 4) {
			authorList = authors.join(", ");
		} else {
			// Show first 3 and count the rest
			const shown = authors.slice(0, 3).join(", ");
			const remaining = authors.length - 3;
			authorList = `${shown}, and ${remaining} other${remaining > 1 ? "s" : ""}`;
		}

		// Add label prefix
		return `Participants: ${authorList}`;
	}

	/**
	 * Update thread status, state, and label
	 * For active threads, shows contributors; for non-active threads, shows status
	 */
	public updateThreadStatus(
		thread: AzDOCommentThread,
		status: string | number,
		serverComments?: PRComment[],
	): void {
		const statusNum = typeof status === "string" ? Number.parseInt(status, 10) : status;

		// Set thread state based on status
		if (statusNum === THREAD_STATUS.RESOLVED || statusNum === THREAD_STATUS.CLOSED) {
			thread.state = vscode.CommentThreadState.Resolved;
		} else {
			thread.state = vscode.CommentThreadState.Unresolved;
		}

		// Update label - prioritize status labels for non-active threads
		const statusLabel = getThreadStatusLabel(status);
		if (statusLabel && statusLabel !== "Active" && !statusLabel.startsWith("[Status:")) {
			thread.label = statusLabel;
		} else if (serverComments) {
			// For active threads, show contributors
			const contributors = this.getThreadContributors(serverComments);
			thread.label = contributors || undefined;
		} else {
			thread.label = undefined;
		}
	}

	/**
	 * Add a temporary comment to a thread
	 */
	public addTemporaryComment(thread: AzDOCommentThread, tempComment: TemporaryComment): void {
		thread.comments = [...thread.comments, tempComment];
		logger.debug(`ThreadManager: Added temporary comment to thread ${thread.threadId}`);
	}

	/**
	 * Replace a temporary comment with a real one
	 */
	public replaceTemporaryComment(
		thread: AzDOCommentThread,
		tempId: string,
		realComment: AzDOComment,
	): void {
		const index = thread.comments.findIndex(
			(c) => c instanceof TemporaryComment && c.tempId === tempId,
		);

		if (index >= 0) {
			const newComments = [...thread.comments];
			newComments[index] = realComment;
			thread.comments = newComments;
			logger.debug(
				`[ThreadManager] Replaced temporary comment ${tempId} in thread ${thread.threadId}`,
			);
		}
	}

	/**
	 * Remove a temporary comment (on error)
	 */
	public removeTemporaryComment(thread: AzDOCommentThread, tempId: string): void {
		thread.comments = thread.comments.filter(
			(c) => !(c instanceof TemporaryComment && c.tempId === tempId),
		);
		logger.debug(
			`[ThreadManager] Removed temporary comment ${tempId} from thread ${thread.threadId}`,
		);
	}

	/**
	 * Sync comment threads with server data using differential updates
	 *
	 * This method implements a sophisticated differential update algorithm that prevents
	 * the "flickering" problem common in comment systems. Instead of disposing and recreating
	 * all threads on every update, it only modifies threads that have actually changed.
	 *
	 * ## Why Differential Updates Matter
	 *
	 * The naive approach of "dispose all, recreate all" causes:
	 * - Visual flickering as threads disappear and reappear
	 * - Loss of user's scroll position
	 * - Interruption of user interactions (editing, replying)
	 * - Poor performance with many threads
	 *
	 * ## Algorithm Overview
	 *
	 * 1. **Identify Stale Threads**: Find local threads that no longer exist on server → dispose them
	 * 2. **Update Existing Threads**: For threads that exist both locally and on server → update in-place
	 * 3. **Create New Threads**: For threads on server but not local → create them
	 *
	 * ## Side-Based Filtering (Prevents Duplicates)
	 *
	 * When viewing a diff, the same comment thread can appear on both:
	 * - **Base side** (left, original file) - uses `leftFileStart`
	 * - **Modified side** (right, new file) - uses `rightFileStart`
	 *
	 * To prevent showing the same comment twice, we:
	 * - Check which side we're syncing (`side` parameter)
	 * - Only show threads that have line numbers for that specific side
	 * - Skip threads with no line number OR line number < 1 (file-level comments)
	 *
	 * ## Edge Cases Handled
	 *
	 * - **Out of bounds lines**: Thread references line 100 but document only has 50 lines → skip
	 * - **File-level comments**: Comments not attached to specific lines → skip
	 * - **Missing line context**: Thread exists but has no line number → skip
	 * - **Deleted threads**: Thread exists locally but not on server → dispose
	 *
	 * @param document - The VS Code document to sync threads for
	 * @param serverThreads - Latest thread data from Azure DevOps API
	 * @param side - Which side of the diff: "base" (left/original) or "modified" (right/new)
	 * @param prContext - Pull request context (project, repo, PR IDs)
	 * @param organizationUrl - Azure DevOps organization URL for profile images
	 * @param currentUserId - Current user's ID for permission checks
	 */
	public syncThreads(
		document: vscode.TextDocument,
		serverThreads: PRThread[],
		side: "base" | "modified",
		prContext: PRContext,
		organizationUrl?: string,
		currentUserId?: string,
	): void {
		const uriString = document.uri.toString();

		// Create a set of server thread IDs for this file
		const serverThreadIds = new Set(serverThreads.map((t) => t.id));

		// Find threads to remove (exist locally but not on server)
		const threadsToRemove: string[] = [];
		for (const [key, thread] of this.threads) {
			if (key.startsWith(uriString) && !serverThreadIds.has(thread.threadId)) {
				threadsToRemove.push(key);
			}
		}

		// Remove stale threads
		for (const key of threadsToRemove) {
			const thread = this.threads.get(key);
			if (thread) {
				thread.dispose();
				this.threads.delete(key);
				logger.debug(`ThreadManager: Removed stale thread ${thread.threadId}`);
			}
		}

		// Update or create threads from server data
		for (const serverThread of serverThreads) {
			// Determine line number based on side - NO FALLBACK to prevent duplicates
			let lineNumber: number | undefined;
			if (side === "modified") {
				// Only show on modified side if it has a right line number
				lineNumber = serverThread.threadContext?.rightFileStart?.line;
			} else {
				// Only show on base side if it has a left line number
				lineNumber = serverThread.threadContext?.leftFileStart?.line;
			}

			// Skip if no line number for this side (prevents duplicates)
			// Also skip file-level comments (no line number)
			if (!lineNumber || lineNumber < 1) {
				continue;
			}

			// Convert to 0-based and check bounds
			const zeroBasedLine = lineNumber - 1;
			if (zeroBasedLine >= document.lineCount) {
				logger.debug(
					`[ThreadManager] Skipping thread ${serverThread.id}: line ${lineNumber} out of bounds`,
				);
				continue;
			}

			const range = new vscode.Range(zeroBasedLine, 0, zeroBasedLine, 0);

			// Get or create thread
			const thread = this.getOrCreateThread(document, range, serverThread.id, prContext);

			// Update comments differentially
			this.updateThreadComments(thread, serverThread.comments, organizationUrl, currentUserId);

			// Update status and label (label shows contributors for active threads)
			this.updateThreadStatus(thread, serverThread.status, serverThread.comments);
		}
	}

	/**
	 * Clear all threads for a document
	 */
	public clearThreadsForDocument(uri: vscode.Uri): void {
		const uriString = uri.toString();
		const threadsToRemove: string[] = [];

		for (const [key, thread] of this.threads) {
			if (key.startsWith(uriString)) {
				thread.dispose();
				threadsToRemove.push(key);
			}
		}

		for (const key of threadsToRemove) {
			this.threads.delete(key);
		}

		logger.debug(`ThreadManager: Cleared ${threadsToRemove.length} threads for ${uri.path}`);
	}

	/**
	 * Clear all threads
	 */
	public clearAll(): void {
		for (const thread of this.threads.values()) {
			thread.dispose();
		}
		this.threads.clear();
		logger.debug("ThreadManager: Cleared all threads");
	}

	/**
	 * Get thread count for debugging
	 */
	public getThreadCount(): number {
		return this.threads.size;
	}
}
