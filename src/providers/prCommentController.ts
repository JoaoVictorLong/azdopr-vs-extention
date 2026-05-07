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

export class PRCommentController {
	private readonly commentController: vscode.CommentController;
	private readonly threadManager: CommentThreadManager;
	private readonly disposables: vscode.Disposable[] = [];

	private readonly loadingPromises: Map<string, Promise<void>> = new Map();
	private readonly debounceTimers: Map<string, NodeJS.Timeout> = new Map();
	private currentUserId?: string;

	constructor(private readonly azureDevOpsClient: AzureDevOpsClient) {
		logger.info("PRCommentController: Initializing comment controller");

		this.commentController = vscode.comments.createCommentController(
			"azdo-pr-comments",
			"Azure DevOps PR Viewer Comments",
		);

		this.threadManager = new CommentThreadManager(this.commentController);

		this.commentController.options = {
			prompt: "Add a comment",
			placeHolder: "Write your comment here...",
		};

		this.setupCommentingRangeProvider();
		this.registerCommands();
	}

	public async initialize(): Promise<void> {
		try {
			const currentUser = await this.azureDevOpsClient.getCurrentUser();
			this.currentUserId = currentUser.id;
			logger.info(`PRCommentController: Initialized with user: ${currentUser.displayName}`);
		} catch (error) {
			logger.warn("PRCommentController: Failed to get current user", error);
		}

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

	private setupCommentingRangeProvider(): void {
		this.commentController.commentingRangeProvider = {
			provideCommentingRanges: (document: vscode.TextDocument): vscode.Range[] | undefined => {
				if (document.uri.scheme === "azdo-pr") {
					const lineCount = document.lineCount;
					return [new vscode.Range(0, 0, lineCount - 1, 0)];
				}
				return undefined;
			},
		};
	}

	private registerCommands(): void {
		this.disposables.push(
			vscode.commands.registerCommand(
				"azdo-pr-comments.createOrReplyComment",
				async (reply: vscode.CommentReply) => {
					await this.handleCommentSubmit(reply);
				},
			),
			vscode.commands.registerCommand("azdo-pr-comments.editComment", (comment: AzDOComment) => {
				this.handleEditComment(comment);
			}),
			vscode.commands.registerCommand(
				"azdo-pr-comments.saveEditedComment",
				async (comment: AzDOComment) => {
					await this.handleSaveEditedComment(comment);
				},
			),
			vscode.commands.registerCommand(
				"azdo-pr-comments.cancelEditComment",
				(comment: AzDOComment) => {
					this.handleCancelEditComment(comment);
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
			vscode.commands.registerCommand(
				"azdo-pr-comments.applySuggestion",
				async (comment: AzDOComment) => {
					await this.handleApplySuggestion(comment);
				},
			),
			vscode.commands.registerCommand("azdo-pr-comments.collapseAllThreads", () => {
				this.handleCollapseAllThreads();
			}),
			vscode.commands.registerCommand("azdo-pr-comments.expandAllThreads", () => {
				this.handleExpandAllThreads();
			}),
			vscode.commands.registerCommand("azdo-pr-comments.addFileComment", async () => {
				await this.handleAddFileComment();
			}),
		);
	}

	public async loadCommentsForDocument(document: vscode.TextDocument): Promise<void> {
		const uriString = document.uri.toString();

		if (document.uri.scheme !== "azdo-pr") {
			return;
		}

		logger.debug(`PRCommentController: Load request for: ${document.uri.path}`);

		if (this.debounceTimers.has(uriString)) {
			clearTimeout(this.debounceTimers.get(uriString));
			this.debounceTimers.delete(uriString);
		}

		this.debounceTimers.set(
			uriString,
			setTimeout(async () => {
				this.debounceTimers.delete(uriString);
				await this.loadCommentsNow(document);
			}, COMMENT_DEBOUNCE_MS),
		);
	}

	private async loadCommentsNow(document: vscode.TextDocument): Promise<void> {
		const uriString = document.uri.toString();

		const existingPromise = this.loadingPromises.get(uriString);
		if (existingPromise) {
			logger.debug(`PRCommentController: Already loading: ${document.uri.path}`);
			return await existingPromise;
		}

		const loadPromise = this.performLoad(document);
		this.loadingPromises.set(uriString, loadPromise);

		try {
			await loadPromise;
		} finally {
			this.loadingPromises.delete(uriString);
		}
	}

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
			const threads = await this.azureDevOpsClient.getPullRequestThreads(
				fileContext.pullRequest.repository.project.id,
				fileContext.pullRequest.repository.id,
				fileContext.pullRequest.pullRequestId,
			);

			logger.debug(`PRCommentController: Fetched ${threads.length} total threads`);

			const fileThreads = this.filterThreadsForFile(threads, fileContext.filePath);

			logger.debug(
				`PRCommentController: Found ${fileThreads.length} threads for ${fileContext.filePath}`,
			);

			let organizationUrl: string | undefined;
			try {
				organizationUrl = this.azureDevOpsClient.getOrganizationUrl();
			} catch (error) {
				logger.warn("Organization URL not available", error);
			}

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

			logger.info(`PRCommentController: Successfully synced ${fileThreads.length} threads`);
		} catch (error) {
			logger.error("PRCommentController: Failed to load comments", error);
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to load comments", error));
		}
	}

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

	/** Strip leading slashes, normalize separators, and lowercase for cross-platform comparison. */
	private normalizePath(path: string): string {
		return path.replace(/^\/+/, "").replaceAll("\\", "/").toLowerCase();
	}

	private async handleCommentSubmit(reply: vscode.CommentReply): Promise<void> {
		try {
			const commentText = reply.text.trim();
			if (!commentText) {
				vscode.window.showWarningMessage("Comment cannot be empty");
				return;
			}

			const contextManager = PRContextManager.getInstance();
			const fileContext = contextManager.getPRFileContext(reply.thread.uri);

			if (!fileContext) {
				vscode.window.showErrorMessage("No PR context found for this file");
				return;
			}

			const pr = fileContext.pullRequest;
			const azdoThread = reply.thread as AzDOCommentThread;
			const isNewThread = !azdoThread.threadId;

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

			try {
				if (isNewThread) {
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

					azdoThread.threadId = createdThread.id;
					azdoThread.prContext = {
						projectId: pr.repository.project.id,
						repositoryId: pr.repository.id,
						pullRequestId: pr.pullRequestId,
					};

					const serverComment = createdThread.comments[0];
					const realComment = tempComment.toRealComment(
						serverComment,
						createdThread.id,
						this.currentUserId,
					);

					this.threadManager.replaceTemporaryComment(azdoThread, tempComment.tempId, realComment);

					vscode.window.showInformationMessage("Comment added successfully");
				} else {
					const newComment = await this.azureDevOpsClient.replyToPRThread(
						pr.repository.project.id,
						pr.repository.id,
						pr.pullRequestId,
						azdoThread.threadId,
						commentText,
					);

					const realComment = tempComment.toRealComment(
						newComment,
						azdoThread.threadId,
						this.currentUserId,
					);

					this.threadManager.replaceTemporaryComment(azdoThread, tempComment.tempId, realComment);

					vscode.window.showInformationMessage("Reply added successfully");
				}
			} catch (error) {
				this.threadManager.removeTemporaryComment(azdoThread, tempComment.tempId);

				vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to add comment", error));
				logger.error("Error adding comment", error);
			}
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to add comment", error));
			logger.error("Error in handleCommentSubmit", error);
		}
	}

	private handleEditComment(comment: AzDOComment): void {
		try {
			comment.startEdit();
			const thread = comment.getThread() as AzDOCommentThread;
			thread.comments = [...thread.comments];
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to enter edit mode", error));
			logger.error("Error entering edit mode", error);
		}
	}

	private async handleSaveEditedComment(comment: AzDOComment): Promise<void> {
		try {
			const newContent = comment.getEditedContent().trim();
			if (!newContent) {
				vscode.window.showWarningMessage("Comment cannot be empty");
				return;
			}

			const thread = comment.getThread() as AzDOCommentThread;
			if (!thread || !thread.threadId || !thread.prContext) {
				throw new Error("Could not find comment thread");
			}

			if (newContent === comment.getEditableContent()) {
				comment.cancelEdit();
				thread.comments = [...thread.comments];
				return;
			}

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

			comment.applyEdit(newContent);
			comment.mode = vscode.CommentMode.Preview;
			thread.comments = [...thread.comments];

			vscode.window.showInformationMessage("Comment updated successfully");
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to save comment", error));
			logger.error("Error saving comment", error);
		}
	}

	private handleCancelEditComment(comment: AzDOComment): void {
		try {
			comment.cancelEdit();
			const thread = comment.getThread() as AzDOCommentThread;
			thread.comments = [...thread.comments];
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to cancel edit", error));
			logger.error("Error cancelling edit", error);
		}
	}

	private async handleDeleteComment(comment: AzDOComment): Promise<void> {
		try {
			const confirmed = await vscode.window.showWarningMessage(
				"Are you sure you want to delete this comment?",
				{ modal: true },
				"Delete",
			);

			if (confirmed !== "Delete") {
				return;
			}

			const thread = comment.getThread() as AzDOCommentThread;
			if (!thread || !thread.threadId || !thread.prContext) {
				throw new Error("Could not find comment thread");
			}

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

			this.threadManager.updateThreadStatus(azdoThread, THREAD_STATUS.RESOLVED);

			vscode.window.showInformationMessage("Thread resolved successfully");
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to resolve thread", error));
			logger.error("Error resolving thread", error);
		}
	}

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

			this.threadManager.updateThreadStatus(azdoThread, THREAD_STATUS.ACTIVE);

			vscode.window.showInformationMessage("Thread unresolved successfully");
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to unresolve thread", error));
			logger.error("Error unresolving thread", error);
		}
	}

	private async handleApplySuggestion(comment: AzDOComment): Promise<void> {
		try {
			const suggestion = comment.extractSuggestion();
			if (!suggestion) {
				vscode.window.showErrorMessage("Could not extract suggestion from comment");
				return;
			}

			const thread = comment.getThread() as AzDOCommentThread;
			if (!thread) {
				vscode.window.showErrorMessage("Could not find comment thread");
				return;
			}

			const contextManager = PRContextManager.getInstance();
			const fileContext = contextManager.getPRFileContext(thread.uri);

			if (!fileContext) {
				vscode.window.showErrorMessage("Could not find file context for this comment");
				return;
			}

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				vscode.window.showErrorMessage(
					"No workspace folder open. Please open the repository first.",
				);
				return;
			}

			const localFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, fileContext.filePath);

			try {
				await vscode.workspace.fs.stat(localFilePath);
			} catch {
				vscode.window.showErrorMessage(
					`File not found locally: ${fileContext.filePath}. Make sure you have the repository checked out.`,
				);
				return;
			}

			const document = await vscode.workspace.openTextDocument(localFilePath);
			const lineIndex = suggestion.originalLine - 1;

			if (lineIndex < 0 || lineIndex >= document.lineCount) {
				vscode.window.showErrorMessage(
					`Line ${suggestion.originalLine} is out of range for file ${fileContext.filePath}`,
				);
				return;
			}

			const edit = new vscode.WorkspaceEdit();
			const lineRange = document.lineAt(lineIndex).range;
			edit.replace(localFilePath, lineRange, suggestion.content);

			const success = await vscode.workspace.applyEdit(edit);

			if (success) {
				await vscode.window.showTextDocument(document, { preview: false });
				vscode.window.showInformationMessage("Suggestion applied successfully");
				logger.info(
					`Applied suggestion from comment ${comment.commentId} to ${fileContext.filePath}:${suggestion.originalLine}`,
				);
			} else {
				vscode.window.showErrorMessage("Failed to apply suggestion");
			}
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to apply suggestion", error));
			logger.error("Error applying suggestion", error);
		}
	}

	public clearCommentsForDocument(uri: vscode.Uri): void {
		this.threadManager.clearThreadsForDocument(uri);
	}

	public async refresh(): Promise<void> {
		logger.debug("PRCommentController: Refreshing all comments");

		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.scheme === "azdo-pr") {
				await this.loadCommentsForDocument(editor.document);
			}
		}
	}

	private handleCollapseAllThreads(): void {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.uri.scheme === "azdo-pr") {
			this.threadManager.collapseAllThreads(editor.document.uri);
			vscode.window.showInformationMessage("All comment threads collapsed");
		} else {
			vscode.window.showWarningMessage("No PR diff file is active");
		}
	}

	private handleExpandAllThreads(): void {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.uri.scheme === "azdo-pr") {
			this.threadManager.expandAllThreads(editor.document.uri);
			vscode.window.showInformationMessage("All comment threads expanded");
		} else {
			vscode.window.showWarningMessage("No PR diff file is active");
		}
	}

	private async handleAddFileComment(): Promise<void> {
		try {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.uri.scheme !== "azdo-pr") {
				vscode.window.showWarningMessage("No PR diff file is active");
				return;
			}

			const contextManager = PRContextManager.getInstance();
			const fileContext = contextManager.getPRFileContext(editor.document.uri);

			if (!fileContext) {
				vscode.window.showErrorMessage("No PR context found for this file");
				return;
			}

			const commentText = await vscode.window.showInputBox({
				prompt: "Enter your file-level comment",
				placeHolder: "Type your comment...",
				ignoreFocusOut: true,
				validateInput: (value) => {
					if (!value.trim()) {
						return "Comment cannot be empty";
					}
					return null;
				},
			});

			if (!commentText) {
				return;
			}

			const pr = fileContext.pullRequest;

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Adding file comment...",
					cancellable: false,
				},
				async () => {
					await this.azureDevOpsClient.createFileLevelThread(
						pr.repository.project.id,
						pr.repository.id,
						pr.pullRequestId,
						fileContext.filePath,
						commentText,
					);
				},
			);

			await this.loadCommentsForDocument(editor.document);

			vscode.window.showInformationMessage("File comment added successfully");
		} catch (error) {
			vscode.window.showErrorMessage(formatErrorWithPrefix("Failed to add file comment", error));
			logger.error("Error adding file comment", error);
		}
	}

	public dispose(): void {
		logger.debug("PRCommentController: Disposing");

		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();

		this.loadingPromises.clear();
		this.threadManager.clearAll();
		this.commentController.dispose();

		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
