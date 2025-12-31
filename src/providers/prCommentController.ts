import * as vscode from "vscode";
import { THREAD_STATUS } from "../constants/azureDevOpsConstants";
import { COMMENT_DEBOUNCE_MS } from "../constants/cacheConfig";
import type { AzureDevOpsClient, PRThread } from "../services/azureDevOpsClient";
import { PRContextManager } from "../services/prContextManager";
import { type AuthorInfo, type AzDOComment, TemporaryComment } from "../types/comments";
import { type AzDOCommentThread, CommentThreadManager } from "../types/commentThread";
import { formatErrorWithPrefix } from "../utils/errorFormatter";
import { Logger } from "../utils/logger";

const logger = Logger.getInstance();

/**
 * ============================================================================
 * PRCommentController - REWRITTEN FOR FLICKER-FREE PERFORMANCE
 * ============================================================================
 *
 * This is a complete rewrite of the comment controller using patterns from
 * the GitHub PR extension. Key improvements:
 *
 * 1. DIFFERENTIAL UPDATES: Comments are updated in-place, not disposed/recreated
 * 2. OPTIMISTIC UPDATES: New comments appear immediately before server confirms
 * 3. NO FLICKERING: Thread state is preserved across updates
 * 4. BETTER STATE MANAGEMENT: Temporary vs confirmed comments
 * 5. DEBOUNCING: Prevents duplicate loads from racing events
 *
 * HOW IT WORKS:
 * - CommentThreadManager tracks all threads and handles differential updates
 * - AzDOComment and TemporaryComment classes manage comment lifecycle
 * - loadCommentsForDocument syncs threads instead of recreating them
 * - Optimistic updates show temporary comments immediately
 * - In-place editing updates comment objects without full reload
 *
 * @see CommentThreadManager for thread lifecycle
 * @see AzDOComment for comment state management
 * @see TemporaryComment for optimistic updates
 */
export class PRCommentController {
	private readonly commentController: vscode.CommentController;
	private readonly threadManager: CommentThreadManager;
	private readonly disposables: vscode.Disposable[] = [];

	/** Prevent duplicate loads for the same document */
	private readonly loadingPromises: Map<string, Promise<void>> = new Map();

	/** Debounce timers to coalesce rapid events */
	private readonly debounceTimers: Map<string, NodeJS.Timeout> = new Map();

	/** Current user ID for permission checks */
	private currentUserId?: string;

	constructor(private readonly azureDevOpsClient: AzureDevOpsClient) {
		logger.info("PRCommentController: Initializing comment controller");

		// Create the comment controller
		this.commentController = vscode.comments.createCommentController(
			"azdo-pr-comments",
			"Azure DevOps PR Viewer Comments",
		);

		// Initialize thread manager
		this.threadManager = new CommentThreadManager(this.commentController);

		// Configure comment controller options
		this.commentController.options = {
			prompt: "Add a comment",
			placeHolder: "Write your comment here...",
		};

		this.setupCommentingRangeProvider();
		this.registerCommands();
	}

	/**
	 * Initialize the comment controller
	 * Fetch current user for permission checks
	 */
	public async initialize(): Promise<void> {
		try {
			const currentUser = await this.azureDevOpsClient.getCurrentUser();
			this.currentUserId = currentUser.id;
			logger.info(`PRCommentController: Initialized with user: ${currentUser.displayName}`);
		} catch (error) {
			logger.warn("PRCommentController: Failed to get current user", error);
		}

		// Load comments for the current editor if it's a PR diff
		if (vscode.window.activeTextEditor) {
			const doc = vscode.window.activeTextEditor.document;
			if (doc.uri.scheme === "azdo-pr") {
				logger.debug(
					`PRCommentController: Loading comments for active editor: ${doc.uri.toString()}`,
				);
				await this.loadCommentsForDocument(doc);
			}
		}
	}

	/**
	 * Setup the commenting range provider
	 */
	private setupCommentingRangeProvider(): void {
		this.commentController.commentingRangeProvider = {
			provideCommentingRanges: (document: vscode.TextDocument): vscode.Range[] | undefined => {
				// Allow commenting on any line in PR diff documents
				if (document.uri.scheme === "azdo-pr") {
					const lineCount = document.lineCount;
					return [new vscode.Range(0, 0, lineCount - 1, 0)];
				}
				return undefined;
			},
		};
	}

	/**
	 * Register command handlers
	 */
	private registerCommands(): void {
		this.disposables.push(
			vscode.commands.registerCommand(
				"azdo-pr-comments.createOrReplyComment",
				async (reply: vscode.CommentReply) => {
					await this.handleCommentSubmit(reply);
				},
			),
			vscode.commands.registerCommand(
				"azdo-pr-comments.editComment",
				async (comment: AzDOComment) => {
					await this.handleEditComment(comment);
				},
			),
			vscode.commands.registerCommand(
				"azdo-pr-comments.deleteComment",
				async (comment: AzDOComment) => {
					await this.handleDeleteComment(comment);
				},
			),
			vscode.commands.registerCommand(
				"azdo-pr-comments.resolveThread",
				async (thread: vscode.CommentThread) => {
					await this.handleResolveThread(thread);
				},
			),
			vscode.commands.registerCommand(
				"azdo-pr-comments.unresolveThread",
				async (thread: vscode.CommentThread) => {
					await this.handleUnresolveThread(thread);
				},
			),
		);
	}

	/**
	 * Load and display comments for a document (with debouncing)
	 * This is the main entry point called by event listeners
	 */
	public async loadCommentsForDocument(document: vscode.TextDocument): Promise<void> {
		const uriString = document.uri.toString();

		// Only process PR diff documents
		if (document.uri.scheme !== "azdo-pr") {
			return;
		}

		logger.debug(`PRCommentController: Load request for: ${document.uri.path}`);

		// Clear any existing debounce timer
		if (this.debounceTimers.has(uriString)) {
			clearTimeout(this.debounceTimers.get(uriString));
			this.debounceTimers.delete(uriString);
		}

		// Set up debounced load
		this.debounceTimers.set(
			uriString,
			setTimeout(async () => {
				this.debounceTimers.delete(uriString);
				await this.loadCommentsNow(document);
			}, COMMENT_DEBOUNCE_MS),
		);
	}

	/**
	 * Actually load comments (after debouncing)
	 */
	private async loadCommentsNow(document: vscode.TextDocument): Promise<void> {
		const uriString = document.uri.toString();

		// Check if already loading this document
		const existingPromise = this.loadingPromises.get(uriString);
		if (existingPromise) {
			logger.debug(`PRCommentController: Already loading: ${document.uri.path}`);
			return await existingPromise;
		}

		// Create loading promise
		const loadPromise = this.performLoad(document);
		this.loadingPromises.set(uriString, loadPromise);

		try {
			await loadPromise;
		} finally {
			this.loadingPromises.delete(uriString);
		}
	}

	/**
	 * Perform the actual comment loading and syncing
	 */
	private async performLoad(document: vscode.TextDocument): Promise<void> {
		const contextManager = PRContextManager.getInstance();
		const fileContext = contextManager.getPRFileContext(document.uri);

		if (!fileContext) {
			logger.debug(`PRCommentController: No context for: ${document.uri.path}`);
			return;
		}

		logger.debug(
			`PRCommentController: Loading comments for PR #${fileContext.pullRequest.pullRequestId}, file: ${fileContext.filePath}, side: ${fileContext.side}`,
		);

		try {
			// Fetch PR threads from server
			const threads = await this.azureDevOpsClient.getPullRequestThreads(
				fileContext.pullRequest.repository.project.id,
				fileContext.pullRequest.repository.id,
				fileContext.pullRequest.pullRequestId,
			);

			logger.debug(`PRCommentController: Fetched ${threads.length} total threads`);

			// Filter threads for this file
			const fileThreads = this.filterThreadsForFile(threads, fileContext.filePath);

			logger.debug(
				`PRCommentController: Found ${fileThreads.length} threads for ${fileContext.filePath}`,
			);

			// Get organization URL for markdown processing
			let organizationUrl: string | undefined;
			try {
				organizationUrl = this.azureDevOpsClient.getOrganizationUrl();
			} catch (error) {
				logger.warn("Organization URL not available", error);
			}

			// Sync threads (differential update - no flicker!)
			const prContext = {
				projectId: fileContext.pullRequest.repository.project.id,
				repositoryId: fileContext.pullRequest.repository.id,
				pullRequestId: fileContext.pullRequest.pullRequestId,
			};

			this.threadManager.syncThreads(
				document,
				fileThreads,
				fileContext.side,
				prContext,
				organizationUrl,
				this.currentUserId,
			);

			// Fetch profile images for all comments asynchronously
			await this.loadProfileImages(fileThreads);

			logger.info(`PRCommentController: Successfully synced ${fileThreads.length} threads`);
		} catch (error) {
			logger.error("PRCommentController: Failed to load comments", error);
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to load comments", error));
		}
	}

	/**
	 * Filter threads for a specific file
	 */
	private filterThreadsForFile(threads: PRThread[], filePath: string): PRThread[] {
		const normalizedPath = this.normalizePath(filePath);

		return threads.filter((thread) => {
			if (!thread.threadContext?.filePath) {
				return false;
			}

			const threadPath = this.normalizePath(thread.threadContext.filePath);
			return threadPath === normalizedPath;
		});
	}

	/**
	 * Normalize file paths for consistent comparison across platforms
	 *
	 * Azure DevOps API returns paths in various formats depending on context:
	 * - Thread context: `/src/file.ts` (leading slash)
	 * - File changes: `src/file.ts` (no leading slash)
	 * - Windows paths: `src\file.ts` (backslashes)
	 *
	 * This method normalizes all paths to a canonical format for reliable matching:
	 * 1. Remove leading slashes
	 * 2. Convert backslashes to forward slashes (Windows → Unix style)
	 * 3. Convert to lowercase (case-insensitive comparison)
	 *
	 * @param path - The file path to normalize
	 * @returns Normalized path in format: `src/file.ts` (lowercase, forward slashes, no leading slash)
	 */
	private normalizePath(path: string): string {
		return path.replace(/^\/+/, "").replaceAll("\\", "/").toLowerCase();
	}

	/**
	 * Load profile images for all comments in threads
	 */
	private async loadProfileImages(threads: PRThread[]): Promise<void> {
		const imagePromises: Promise<void>[] = [];

		for (const thread of threads) {
			for (const comment of thread.comments) {
				if (comment.author.imageUrl) {
					imagePromises.push(this.loadProfileImage(comment.author.imageUrl, comment.id));
				}
			}
		}

		await Promise.all(imagePromises);
	}

	/**
	 * Load a single profile image as data URI
	 */
	private async loadProfileImage(imageUrl: string, commentId: number): Promise<void> {
		try {
			const dataUri = await this.azureDevOpsClient.getImageAsDataUri(imageUrl);
			if (dataUri) {
				// Find the comment and update its icon
				// This will be handled by the comment objects themselves
				logger.debug(`PRCommentController: Loaded image for comment ${commentId}`);
			}
		} catch (error) {
			logger.warn(`PRCommentController: Failed to load image for comment ${commentId}:`, error);
		}
	}

	/**
	 * Handle comment submission (with optimistic update)
	 */
	private async handleCommentSubmit(reply: vscode.CommentReply): Promise<void> {
		try {
			const commentText = reply.text.trim();
			if (!commentText) {
				vscode.window.showWarningMessage("Comment cannot be empty");
				return;
			}

			// Get PR context
			const contextManager = PRContextManager.getInstance();
			const fileContext = contextManager.getPRFileContext(reply.thread.uri);

			if (!fileContext) {
				vscode.window.showErrorMessage("No PR context found for this file");
				return;
			}

			const pr = fileContext.pullRequest;
			const azdoThread = reply.thread as AzDOCommentThread;
			const isNewThread = !azdoThread.threadId;

			// Get current user info
			let currentUser: AuthorInfo;
			try {
				const user = await this.azureDevOpsClient.getCurrentUser();
				currentUser = {
					id: user.id,
					displayName: user.displayName,
					uniqueName: user.uniqueName || user.displayName,
					imageUrl: user.imageUrl,
				};
			} catch (error) {
				logger.error("Failed to get current user", error);
				vscode.window.showErrorMessage("Failed to get current user information");
				return;
			}

			// Optimistic update: Show temporary comment immediately
			let organizationUrl: string | undefined;
			try {
				organizationUrl = this.azureDevOpsClient.getOrganizationUrl();
			} catch (_error) {
				// Ignore
			}

			const tempComment = new TemporaryComment(
				commentText,
				currentUser,
				reply.thread,
				organizationUrl,
			);

			this.threadManager.addTemporaryComment(azdoThread, tempComment);

			// Submit to server
			try {
				if (isNewThread) {
					// Create new thread
					if (!reply.thread.range) {
						throw new Error("Cannot create new thread without a range");
					}
					const lineNumber = reply.thread.range.start.line + 1;

					const createdThread = await this.azureDevOpsClient.createPRThread(
						pr.repository.project.id,
						pr.repository.id,
						pr.pullRequestId,
						fileContext.filePath,
						lineNumber,
						commentText,
						fileContext.side,
					);

					// Update thread ID
					azdoThread.threadId = createdThread.id;
					azdoThread.prContext = {
						projectId: pr.repository.project.id,
						repositoryId: pr.repository.id,
						pullRequestId: pr.pullRequestId,
					};

					// Replace temporary comment with real one
					const serverComment = createdThread.comments[0];
					const realComment = tempComment.toRealComment(
						serverComment,
						createdThread.id,
						this.currentUserId,
					);

					this.threadManager.replaceTemporaryComment(azdoThread, tempComment.tempId, realComment);

					vscode.window.showInformationMessage("Comment added successfully");
				} else {
					// Reply to existing thread
					const newComment = await this.azureDevOpsClient.replyToPRThread(
						pr.repository.project.id,
						pr.repository.id,
						pr.pullRequestId,
						azdoThread.threadId,
						commentText,
					);

					// Replace temporary comment with real one
					const realComment = tempComment.toRealComment(
						newComment,
						azdoThread.threadId,
						this.currentUserId,
					);

					this.threadManager.replaceTemporaryComment(azdoThread, tempComment.tempId, realComment);

					vscode.window.showInformationMessage("Reply added successfully");
				}
			} catch (error) {
				// Remove temporary comment on error
				this.threadManager.removeTemporaryComment(azdoThread, tempComment.tempId);

				vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to add comment", error));
				logger.error("Error adding comment", error);
			}
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to add comment", error));
			logger.error("Error in handleCommentSubmit", error);
		}
	}

	/**
	 * Handle comment edit (in-place, no reload!)
	 */
	private async handleEditComment(comment: AzDOComment): Promise<void> {
		try {
			const currentContent = comment.getEditableContent();

			// Prompt user to edit
			const newContent = await vscode.window.showInputBox({
				value: currentContent,
				prompt: "Edit your comment",
				ignoreFocusOut: true,
				validateInput: (value) => {
					if (!value.trim()) {
						return "Comment cannot be empty";
					}
					return null;
				},
			});

			if (!newContent || newContent === currentContent) {
				return; // User cancelled or no changes
			}

			// Find the thread containing this comment
			const thread = comment.getThread() as AzDOCommentThread;
			if (!thread || !thread.threadId || !thread.prContext) {
				throw new Error("Could not find comment thread");
			}

			// Update comment on server
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Updating comment...",
					cancellable: false,
				},
				async () => {
					await this.azureDevOpsClient.updateComment(
						thread.prContext.projectId,
						thread.prContext.repositoryId,
						thread.prContext.pullRequestId,
						thread.threadId,
						comment.commentId,
						newContent,
					);
				},
			);

			// Update comment in place (no reload!)
			comment.applyEdit(newContent);

			vscode.window.showInformationMessage("Comment updated successfully");
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to edit comment", error));
			logger.error("Error editing comment", error);
		}
	}

	/**
	 * Handle comment delete
	 */
	private async handleDeleteComment(comment: AzDOComment): Promise<void> {
		try {
			// Confirm deletion
			const confirmed = await vscode.window.showWarningMessage(
				"Are you sure you want to delete this comment?",
				{ modal: true },
				"Delete",
			);

			if (confirmed !== "Delete") {
				return;
			}

			// Find the thread
			const thread = comment.getThread() as AzDOCommentThread;
			if (!thread || !thread.threadId || !thread.prContext) {
				throw new Error("Could not find comment thread");
			}

			// Delete comment on server
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Deleting comment...",
					cancellable: false,
				},
				async () => {
					await this.azureDevOpsClient.deleteComment(
						thread.prContext.projectId,
						thread.prContext.repositoryId,
						thread.prContext.pullRequestId,
						thread.threadId,
						comment.commentId,
					);
				},
			);

			// Reload comments to reflect deletion
			const document = vscode.workspace.textDocuments.find(
				(doc) => doc.uri.toString() === thread.uri.toString(),
			);

			if (document) {
				await this.loadCommentsForDocument(document);
			}

			vscode.window.showInformationMessage("Comment deleted successfully");
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to delete comment", error));
			logger.error("Error deleting comment", error);
		}
	}

	/**
	 * Handle thread resolve
	 */
	private async handleResolveThread(thread: vscode.CommentThread): Promise<void> {
		const azdoThread = thread as AzDOCommentThread;
		if (!azdoThread.threadId || !azdoThread.prContext) {
			vscode.window.showErrorMessage("Invalid thread");
			return;
		}

		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Resolving thread...",
					cancellable: false,
				},
				async () => {
					await this.azureDevOpsClient.updateThreadStatus(
						azdoThread.prContext.projectId,
						azdoThread.prContext.repositoryId,
						azdoThread.prContext.pullRequestId,
						azdoThread.threadId,
						THREAD_STATUS.RESOLVED,
					);
				},
			);

			// Update thread state locally
			this.threadManager.updateThreadStatus(azdoThread, THREAD_STATUS.RESOLVED);

			vscode.window.showInformationMessage("Thread resolved successfully");
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to resolve thread", error));
			logger.error("Error resolving thread", error);
		}
	}

	/**
	 * Handle thread unresolve
	 */
	private async handleUnresolveThread(thread: vscode.CommentThread): Promise<void> {
		const azdoThread = thread as AzDOCommentThread;
		if (!azdoThread.threadId || !azdoThread.prContext) {
			vscode.window.showErrorMessage("Invalid thread");
			return;
		}

		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Unresolving thread...",
					cancellable: false,
				},
				async () => {
					await this.azureDevOpsClient.updateThreadStatus(
						azdoThread.prContext.projectId,
						azdoThread.prContext.repositoryId,
						azdoThread.prContext.pullRequestId,
						azdoThread.threadId,
						THREAD_STATUS.ACTIVE,
					);
				},
			);

			// Update thread state locally
			this.threadManager.updateThreadStatus(azdoThread, THREAD_STATUS.ACTIVE);

			vscode.window.showInformationMessage("Thread unresolved successfully");
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to unresolve thread", error));
			logger.error("Error unresolving thread", error);
		}
	}

	/**
	 * Clear comments for a specific document
	 */
	public clearCommentsForDocument(uri: vscode.Uri): void {
		this.threadManager.clearThreadsForDocument(uri);
	}

	/**
	 * Refresh all comments
	 */
	public async refresh(): Promise<void> {
		logger.debug("PRCommentController: Refreshing all comments");

		// Reload comments for all visible PR diff editors
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.scheme === "azdo-pr") {
				await this.loadCommentsForDocument(editor.document);
			}
		}
	}

	/**
	 * Dispose of resources
	 */
	public dispose(): void {
		logger.debug("PRCommentController: Disposing");

		// Clear all debounce timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();

		// Clear loading promises
		this.loadingPromises.clear();

		// Dispose thread manager
		this.threadManager.clearAll();

		// Dispose comment controller
		this.commentController.dispose();

		// Dispose other resources
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
