import * as vscode from "vscode";
import { THREAD_STATUS } from "../constants/azureDevOpsConstants";
import type { PRComment, PRThread } from "../services/azureDevOpsClient";
import { getThreadStatusLabel } from "../utils/commentFormatter";
import { Logger } from "../utils/logger";
import { AzDOComment, TemporaryComment } from "./comments";

const logger = Logger.getInstance();

export interface PRContext {
	projectId: string;
	repositoryId: string;
	pullRequestId: number;
}

export interface AzDOCommentThread extends vscode.CommentThread {
	threadId: number;
	prContext: PRContext;
	isLoading?: boolean;
	comments: ReadonlyArray<AzDOComment | TemporaryComment>;
}

export class CommentThreadManager {
	private readonly threads: Map<string, AzDOCommentThread> = new Map();
	private readonly commentController: vscode.CommentController;

	constructor(commentController: vscode.CommentController) {
		this.commentController = commentController;
	}

	private getThreadKey(uri: vscode.Uri, threadId: number): string {
		return `${uri.toString()}#${threadId}`;
	}

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

	public getAllThreadKeys(): string[] {
		return Array.from(this.threads.keys());
	}

	public getThread(threadKey: string): AzDOCommentThread | undefined {
		return this.threads.get(threadKey);
	}

	public getOrCreateThread(
		document: vscode.TextDocument,
		range: vscode.Range,
		threadId: number,
		prContext: PRContext,
	): AzDOCommentThread {
		const threadKey = this.getThreadKey(document.uri, threadId);
		const existing = this.threads.get(threadKey);

		if (existing) {
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

	public updateThreadComments(
		thread: AzDOCommentThread,
		newServerComments: PRComment[],
		organizationUrl?: string,
		currentUserId?: string,
	): boolean {
		const existingComments = thread.comments as AzDOComment[];

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

		let hasChanges = false;
		const updatedComments: AzDOComment[] = [];

		for (let i = 0; i < newServerComments.length; i++) {
			const serverComment = newServerComments[i];
			const existingComment = existingComments[i];

			if (existingComment instanceof TemporaryComment) {
				const identityResolver = this.buildIdentityResolver(newServerComments);
				updatedComments.push(
					new AzDOComment(
						serverComment,
						thread.threadId,
						thread,
						organizationUrl,
						currentUserId,
						identityResolver,
					),
				);
				hasChanges = true;
				continue;
			}

			if (existingComment.commentId !== serverComment.id) {
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

			const changed = existingComment.update(serverComment);
			if (changed) {
				hasChanges = true;
			}
			updatedComments.push(existingComment);
		}

		if (hasChanges) {
			thread.comments = updatedComments;
			logger.debug(`ThreadManager: Updated thread ${thread.threadId}: content changed`);
		}

		return hasChanges;
	}

	private createComments(
		serverComments: PRComment[],
		threadId: number,
		parent: vscode.CommentThread,
		organizationUrl?: string,
		currentUserId?: string,
	): AzDOComment[] {
		const identityResolver = this.buildIdentityResolver(serverComments);
		return serverComments.map(
			(comment) =>
				new AzDOComment(
					comment,
					threadId,
					parent,
					organizationUrl,
					currentUserId,
					identityResolver,
				),
		);
	}

	private buildIdentityResolver(serverComments: PRComment[]): Map<string, string> {
		const resolver = new Map<string, string>();
		for (const comment of serverComments) {
			if (comment.author?.id && comment.author?.displayName) {
				resolver.set(comment.author.id.toLowerCase(), comment.author.displayName);
			}
		}
		return resolver;
	}

	private getThreadContributors(comments: PRComment[]): string {
		if (comments.length === 0) {
			return "";
		}

		const uniqueAuthors = new Set<string>();
		for (const comment of comments) {
			uniqueAuthors.add(comment.author.displayName);
		}

		const authors = Array.from(uniqueAuthors);

		let authorList: string;
		if (authors.length === 1) {
			authorList = authors[0];
		} else if (authors.length === 2) {
			authorList = `${authors[0]} and ${authors[1]}`;
		} else if (authors.length <= 4) {
			authorList = authors.join(", ");
		} else {
			const shown = authors.slice(0, 3).join(", ");
			const remaining = authors.length - 3;
			authorList = `${shown}, and ${remaining} other${remaining > 1 ? "s" : ""}`;
		}

		return `Participants: ${authorList}`;
	}

	public updateThreadStatus(
		thread: AzDOCommentThread,
		status: string | number,
		serverComments?: PRComment[],
	): void {
		const statusNum = typeof status === "string" ? Number.parseInt(status, 10) : status;

		if (statusNum === THREAD_STATUS.RESOLVED || statusNum === THREAD_STATUS.CLOSED) {
			thread.state = vscode.CommentThreadState.Resolved;
		} else {
			thread.state = vscode.CommentThreadState.Unresolved;
		}

		const statusLabel = getThreadStatusLabel(status);
		if (statusLabel && statusLabel !== "Active" && !statusLabel.startsWith("[Status:")) {
			thread.label = statusLabel;
		} else if (serverComments) {
			const contributors = this.getThreadContributors(serverComments);
			thread.label = contributors || undefined;
		} else {
			thread.label = undefined;
		}

		const autoCollapseResolved = vscode.workspace
			.getConfiguration("azureDevOpsPRViewer.comments")
			.get<boolean>("autoCollapseResolved", true);
		if (autoCollapseResolved && thread.state === vscode.CommentThreadState.Resolved) {
			thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
		}
	}

	public addTemporaryComment(thread: AzDOCommentThread, tempComment: TemporaryComment): void {
		thread.comments = [...thread.comments, tempComment];
		logger.debug(`ThreadManager: Added temporary comment to thread ${thread.threadId}`);
	}

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

	public removeTemporaryComment(thread: AzDOCommentThread, tempId: string): void {
		thread.comments = thread.comments.filter(
			(c) => !(c instanceof TemporaryComment && c.tempId === tempId),
		);
		logger.debug(
			`[ThreadManager] Removed temporary comment ${tempId} from thread ${thread.threadId}`,
		);
	}

	/**
	 * Sync threads with server data using differential updates.
	 * Uses side-based filtering to prevent duplicate threads in diff views.
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

		const serverThreadIds = new Set(serverThreads.map((t) => t.id));

		const threadsToRemove: string[] = [];
		for (const [key, thread] of this.threads) {
			if (key.startsWith(uriString) && !serverThreadIds.has(thread.threadId)) {
				threadsToRemove.push(key);
			}
		}

		for (const key of threadsToRemove) {
			const thread = this.threads.get(key);
			if (thread) {
				thread.dispose();
				this.threads.delete(key);
				logger.debug(`ThreadManager: Removed stale thread ${thread.threadId}`);
			}
		}

		for (const serverThread of serverThreads) {
			let lineNumber: number | undefined;
			let isFileLevelComment = false;

			if (side === "modified") {
				lineNumber = serverThread.threadContext?.rightFileStart?.line;
			} else {
				lineNumber = serverThread.threadContext?.leftFileStart?.line;
			}

			if (!lineNumber && serverThread.threadContext?.filePath) {
				const hasAnyLineNumber =
					serverThread.threadContext.leftFileStart?.line ||
					serverThread.threadContext.rightFileStart?.line;

				if (!hasAnyLineNumber) {
					// This is a file-level comment - show at line 0
					lineNumber = 1; // Show at first line
					isFileLevelComment = true;
				} else {
					continue;
				}
			}

			if (!lineNumber || lineNumber < 1) {
				continue;
			}

			const zeroBasedLine = lineNumber - 1;
			if (zeroBasedLine >= document.lineCount) {
				logger.debug(
					`[ThreadManager] Skipping thread ${serverThread.id}: line ${lineNumber} out of bounds`,
				);
				continue;
			}

			const range = new vscode.Range(zeroBasedLine, 0, zeroBasedLine, 0);

			const thread = this.getOrCreateThread(document, range, serverThread.id, prContext);

			this.updateThreadComments(thread, serverThread.comments, organizationUrl, currentUserId);

			this.updateThreadStatus(thread, serverThread.status, serverThread.comments);

			if (isFileLevelComment) {
				thread.label = thread.label ? `File Comment • ${thread.label}` : "File Comment";
			}
		}
	}

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

	public clearAll(): void {
		for (const thread of this.threads.values()) {
			thread.dispose();
		}
		this.threads.clear();
		logger.debug("ThreadManager: Cleared all threads");
	}

	public getThreadCount(): number {
		return this.threads.size;
	}

	public collapseAllThreads(uri: vscode.Uri): void {
		const uriString = uri.toString();
		for (const [key, thread] of this.threads) {
			if (key.startsWith(uriString)) {
				thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
			}
		}
		logger.debug(`ThreadManager: Collapsed all threads for ${uri.path}`);
	}

	public expandAllThreads(uri: vscode.Uri): void {
		const uriString = uri.toString();
		for (const [key, thread] of this.threads) {
			if (key.startsWith(uriString)) {
				thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
			}
		}
		logger.debug(`ThreadManager: Expanded all threads for ${uri.path}`);
	}
}
