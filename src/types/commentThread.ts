import * as vscode from "vscode";
import type { PRThread, PRComment } from "../services/azureDevOpsClient";
import { AzDOComment, TemporaryComment } from "./comments";
import { getThreadStatusLabel } from "../utils/commentFormatter";

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

		console.log(
			`[ThreadManager] Created new thread ${threadId} at line ${range.start.line + 1}`,
		);

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
			console.log(
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
					new AzDOComment(
						serverComment,
						thread.threadId,
						thread,
						organizationUrl,
						currentUserId,
					),
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
				console.log(
					`[ThreadManager] Updated thread ${thread.threadId}: comment order changed`,
				);
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
			console.log(
				`[ThreadManager] Updated thread ${thread.threadId}: content changed`,
			);
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
			(comment) =>
				new AzDOComment(
					comment,
					threadId,
					parent,
					organizationUrl,
					currentUserId,
				),
		);
	}

	/**
	 * Update thread status and state
	 */
	public updateThreadStatus(
		thread: AzDOCommentThread,
		status: string | number,
	): void {
		const statusNum =
			typeof status === "string" ? Number.parseInt(status, 10) : status;

		// Set thread state based on status
		// Status 2 = Resolved, Status 4 = Closed
		if (statusNum === 2 || statusNum === 4) {
			thread.state = vscode.CommentThreadState.Resolved;
		} else {
			thread.state = vscode.CommentThreadState.Unresolved;
		}

		// Update label
		const statusLabel = getThreadStatusLabel(status);
		if (
			statusLabel &&
			statusLabel !== "Active" &&
			!statusLabel.startsWith("[Status:")
		) {
			thread.label = statusLabel;
		} else {
			thread.label = undefined;
		}
	}

	/**
	 * Add a temporary comment to a thread
	 */
	public addTemporaryComment(
		thread: AzDOCommentThread,
		tempComment: TemporaryComment,
	): void {
		thread.comments = [...thread.comments, tempComment];
		console.log(
			`[ThreadManager] Added temporary comment to thread ${thread.threadId}`,
		);
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
			console.log(
				`[ThreadManager] Replaced temporary comment ${tempId} in thread ${thread.threadId}`,
			);
		}
	}

	/**
	 * Remove a temporary comment (on error)
	 */
	public removeTemporaryComment(
		thread: AzDOCommentThread,
		tempId: string,
	): void {
		thread.comments = thread.comments.filter(
			(c) =>
				!(c instanceof TemporaryComment && c.tempId === tempId),
		);
		console.log(
			`[ThreadManager] Removed temporary comment ${tempId} from thread ${thread.threadId}`,
		);
	}

	/**
	 * Sync threads with server data
	 * Only creates/disposes threads that actually changed
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
			if (
				key.startsWith(uriString) &&
				!serverThreadIds.has(thread.threadId)
			) {
				threadsToRemove.push(key);
			}
		}

		// Remove stale threads
		for (const key of threadsToRemove) {
			const thread = this.threads.get(key);
			if (thread) {
				thread.dispose();
				this.threads.delete(key);
				console.log(
					`[ThreadManager] Removed stale thread ${thread.threadId}`,
				);
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
				console.log(
					`[ThreadManager] Skipping thread ${serverThread.id}: line ${lineNumber} out of bounds`,
				);
				continue;
			}

			const range = new vscode.Range(zeroBasedLine, 0, zeroBasedLine, 0);

			// Get or create thread
			const thread = this.getOrCreateThread(
				document,
				range,
				serverThread.id,
				prContext,
			);

			// Update comments differentially
			this.updateThreadComments(
				thread,
				serverThread.comments,
				organizationUrl,
				currentUserId,
			);

			// Update status
			this.updateThreadStatus(thread, serverThread.status);
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

		console.log(
			`[ThreadManager] Cleared ${threadsToRemove.length} threads for ${uri.path}`,
		);
	}

	/**
	 * Clear all threads
	 */
	public clearAll(): void {
		for (const thread of this.threads.values()) {
			thread.dispose();
		}
		this.threads.clear();
		console.log("[ThreadManager] Cleared all threads");
	}

	/**
	 * Get thread count for debugging
	 */
	public getThreadCount(): number {
		return this.threads.size;
	}
}
