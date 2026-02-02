import * as vscode from "vscode";
import type {
	AzureDevOpsClient,
	PRFileChange,
	PRIteration,
	PRThread,
	PullRequest,
} from "../services/azureDevOpsClient";
import { FileHandlerRegistry, type PRContext } from "../services/lfs/fileTypeHandlers";
import { PdfFileHandler } from "../services/lfs/handlers/pdfHandler";
import { LfsService } from "../services/lfs/lfsService";
import { PRCacheService } from "../services/prCache";
import { PRContextManager, type PRFileContext } from "../services/prContextManager";
import type { ReviewedFilesService } from "../services/reviewedFilesService";
import {
	cleanCommentContent,
	formatTimeAgo,
	getThreadStatusLabel,
} from "../utils/commentFormatter";
import { sanitizeHtml, escapeHtml, autoLinkUrls } from '../utils/htmlSanitizer';
import { Logger } from "../utils/logger";

const logger = Logger.getInstance();

export class PullRequestViewerPanel {
	private static _currentPanel: PullRequestViewerPanel | undefined;
	private static _contentProviderRegistered: boolean = false;
	private static readonly _virtualFileCache: Map<
		string,
		{ content: string; timestamp: number; prId: number }
	> = new Map();
	// biome-ignore lint/suspicious/noExplicitAny: marked library is ESM, using any for dynamic import
	private static _markedPromise: Promise<any> | undefined;
	private static _lfsService: LfsService | undefined;
	private static _fileHandlerRegistry: FileHandlerRegistry | undefined;
	private static _reviewedFilesService: ReviewedFilesService | undefined;

	public static get currentPanel(): PullRequestViewerPanel | undefined {
		return PullRequestViewerPanel._currentPanel;
	}

	// biome-ignore lint/suspicious/noExplicitAny: marked library is ESM, using any for dynamic import
	private static async getMarked(): Promise<any> {
		PullRequestViewerPanel._markedPromise ??= import("marked");
		return PullRequestViewerPanel._markedPromise;
	}

	private readonly _panel: vscode.WebviewPanel;
	private readonly _disposables: vscode.Disposable[] = [];
	private currentUserId?: string;

	private constructor(
		panel: vscode.WebviewPanel,
		private readonly azureDevOpsClient: AzureDevOpsClient,
		private pullRequest: PullRequest,
		currentUserId?: string,
	) {
		this.currentUserId = currentUserId;
		this._panel = panel;

		// Set the current PR context
		PRContextManager.getInstance().setCurrentPR(pullRequest);

		// Set the webview's initial html content (synchronous loading state)
		this._panel.webview.html = this._getLoadingHtml();

		// Listen for when the panel is disposed
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			async (message) => {
				logger.debug("Received message from webview:", message);
				switch (message.command) {
					case "openFile":
						logger.debug(
							`Opening file from webview: ${message.path} changeType: ${message.changeType} originalPath: ${message.originalPath}`,
						);
						await this._openFileDiff(message.path, message.changeType, message.originalPath);
						break;
					case "openExternal":
						vscode.env.openExternal(vscode.Uri.parse(message.url));
						break;
					case "submitReview":
						await this._handleReviewSubmission(message.vote);
						break;
					case "refresh":
						logger.debug("Refresh requested from webview");
						await this.refreshWithFreshData();
						break;
					case "toggleFileReviewed":
						await this._handleToggleReviewed(message.filePath);
						break;
					case "replyToThread":
						await this._handleReplyToThread(message.threadId, message.content);
						break;
					case "editComment":
						await this._handleEditComment(message.threadId, message.commentId, message.content);
						break;
					case "deleteComment":
						await this._handleDeleteComment(message.threadId, message.commentId);
						break;
					case "resolveThread":
						await this._handleResolveThread(message.threadId);
						break;
					case "unresolveThread":
						await this._handleUnresolveThread(message.threadId);
						break;
					default:
						logger.debug("Unknown command:", message.command);
				}
			},
			null,
			this._disposables,
		);
	}

	public static async createOrShow(
		extensionUri: vscode.Uri,
		azureDevOpsClient: AzureDevOpsClient,
		pullRequest: PullRequest,
		reviewedFilesService: ReviewedFilesService,
	) {
		// Store the reviewed files service
		PullRequestViewerPanel._reviewedFilesService = reviewedFilesService;
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// Get current user ID for permission checks on comments
		let currentUserId: string | undefined;
		try {
			const currentUser = await azureDevOpsClient.getCurrentUser();
			currentUserId = currentUser?.id;
		} catch (error) {
			logger.warn("Failed to get current user for comment permissions", error);
		}

		// If we already have a panel, show it
		if (PullRequestViewerPanel.currentPanel) {
			PullRequestViewerPanel.currentPanel._panel.reveal(column);
			// Update with new PR data
			PullRequestViewerPanel.currentPanel.pullRequest = pullRequest;
			PullRequestViewerPanel.currentPanel.currentUserId = currentUserId;
			await PullRequestViewerPanel.currentPanel._update();
			return;
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			"azureDevOpsPRViewer",
			`PR #${pullRequest.pullRequestId}: ${pullRequest.title}`,
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			},
		);

		const instance = new PullRequestViewerPanel(
			panel,
			azureDevOpsClient,
			pullRequest,
			currentUserId,
		);
		PullRequestViewerPanel._currentPanel = instance;

		// Initialize the panel content asynchronously
		await instance._update();
	}

	/**
	 * Clean up virtual file cache
	 * Removes old entries and entries for a specific PR
	 */
	private static cleanupCache(prId?: number): void {
		const now = Date.now();
		const maxAge = 30 * 60 * 1000; // 30 minutes

		const keysToRemove: string[] = [];
		for (const [key, value] of PullRequestViewerPanel._virtualFileCache) {
			// Remove if it's for the specified PR
			if (prId !== undefined && value.prId === prId) {
				keysToRemove.push(key);
			}
			// Remove if older than max age
			else if (now - value.timestamp > maxAge) {
				keysToRemove.push(key);
			}
		}

		for (const key of keysToRemove) {
			PullRequestViewerPanel._virtualFileCache.delete(key);
		}

		if (keysToRemove.length > 0) {
			logger.debug(`PullRequestViewerPanel: Cleaned up ${keysToRemove.length} cached file(s)`);
		}
	}

	public dispose() {
		// Clean up cache for this PR
		if (this.pullRequest) {
			PullRequestViewerPanel.cleanupCache(this.pullRequest.pullRequestId);
		}

		PullRequestViewerPanel._currentPanel = undefined;

		this._panel.dispose();

		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	/**
	 * Invalidate the cache for the current PR
	 * This forces a fresh fetch on the next update
	 */
	public invalidateCache(): void {
		const cache = PRCacheService.getInstance();
		cache.invalidate(
			this.pullRequest.repository.project.id,
			this.pullRequest.repository.id,
			this.pullRequest.pullRequestId,
		);
	}

	/**
	 * Refresh the PR view with fresh data from the API
	 */
	public async refreshWithFreshData(): Promise<void> {
		this.invalidateCache();
		await this._update();
	}

	private async _update() {
		const webview = this._panel.webview;
		this._panel.title = `PR #${this.pullRequest.pullRequestId}: ${this.pullRequest.title}`;

		try {
			// Validate required PR properties
			if (!this.pullRequest.repository?.project) {
				throw new Error("Pull request is missing required repository or project information");
			}

			webview.html = this._getLoadingHtml();

			const projectId = this.pullRequest.repository.project.id;
			const repositoryId = this.pullRequest.repository.id;
			const pullRequestId = this.pullRequest.pullRequestId;

			// Get cache service
			const cache = PRCacheService.getInstance();

			// Try to get cached data first
			const cachedData = cache.get(projectId, repositoryId, pullRequestId);

			let fullPRDetails: PullRequest;
			let iterations: PRIteration[];
			let fileChanges: PRFileChange[];
			let threads: PRThread[];
			let cacheInfo: { isCached: boolean; ageInSeconds?: number };

			if (cachedData) {
				// Use cached data
				logger.debug(`PRViewerPanel: Using cached data for PR #${pullRequestId}`);
				fullPRDetails = cachedData.fullDetails;
				// iterations not needed here - only used when fetching fresh file changes
				fileChanges = cachedData.fileChanges;
				threads = cachedData.threads;
				const ageMs = Date.now() - cachedData.timestamp;
				cacheInfo = { isCached: true, ageInSeconds: Math.floor(ageMs / 1000) };
			} else {
				// Fetch fresh data from API
				logger.debug(`PRViewerPanel: Fetching fresh data for PR #${pullRequestId}`);

				// Fetch full PR details to get complete description (list API truncates it)
				fullPRDetails = await this.azureDevOpsClient.getPullRequestDetails(
					projectId,
					repositoryId,
					pullRequestId,
				);

				// Fetch iterations
				iterations = await this.azureDevOpsClient.getPullRequestIterations(
					projectId,
					repositoryId,
					pullRequestId,
				);

				// Get file changes from the latest iteration
				fileChanges = [];
				if (iterations.length > 0) {
					const latestIteration = iterations.at(-1);
					if (latestIteration) {
						fileChanges = await this.azureDevOpsClient.getPullRequestIterationChanges(
							projectId,
							repositoryId,
							pullRequestId,
							latestIteration.id,
						);
					}
				}

				// Fetch PR threads (comments)
				threads = await this.azureDevOpsClient.getPullRequestThreads(
					projectId,
					repositoryId,
					pullRequestId,
				);

				// Store in cache
				cache.set(
					projectId,
					repositoryId,
					pullRequestId,
					fullPRDetails,
					iterations,
					fileChanges,
					threads,
				);
				cacheInfo = { isCached: false };
			}

			// Update the entire PR object with fresh/cached details to ensure all fields are current
			// This includes title, description, status, isDraft, reviewers, and all other fields
			this.pullRequest = fullPRDetails;

			// Convert markdown description to HTML
			const { marked } = await PullRequestViewerPanel.getMarked();
			const descriptionHtml = this.pullRequest.description
				? await marked(this.pullRequest.description)
				: "No description provided.";

			webview.html = this._getHtmlForWebview(
				webview,
				fileChanges,
				threads,
				descriptionHtml,
				cacheInfo,
			);
		} catch (error) {
			const friendlyMessage = this._getFriendlyErrorMessage(error);
			logger.error("Error loading pull request:", error);
			webview.html = this._getErrorHtml(friendlyMessage);
		}
	}

	private _getLoadingHtml(): string {
		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Loading...</title>
            <style>
                body {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                }
                .loading {
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <div class="loading">
                <h2>Loading Pull Request...</h2>
                <p>Please wait while we fetch the PR details.</p>
            </div>
        </body>
        </html>`;
	}

	private _getErrorHtml(errorMessage: string): string {
		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                }
                .error {
                    color: var(--vscode-errorForeground);
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    padding: 15px;
                    border-radius: 4px;
                }
            </style>
        </head>
        <body>
            <h2>Error Loading Pull Request</h2>
            <div class="error">
                <p>${errorMessage}</p>
            </div>
        </body>
        </html>`;
	}

	private _getHtmlForWebview(
		webview: vscode.Webview,
		fileChanges: PRFileChange[],
		threads: PRThread[],
		descriptionHtml: string,
		cacheInfo: { isCached: boolean; ageInSeconds?: number },
	): string {
		const pr = this.pullRequest;
		const nonce = getNonce();

		// Format dates
		const createdDate = pr.creationDate.toLocaleDateString();
		const createdTime = pr.creationDate.toLocaleTimeString();

		// Format branch names
		const sourceBranch = pr.sourceRefName ? pr.sourceRefName.replace("refs/heads/", "") : "unknown";
		const targetBranch = pr.targetRefName ? pr.targetRefName.replace("refs/heads/", "") : "unknown";

		// Build HTML using array join to avoid template literal issues with description content
		const parts = [
			"<!DOCTYPE html>",
			'<html lang="en">',
			"<head>",
			'<meta charset="UTF-8">',
			'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
			`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">`,
			`<title>PR #${pr.pullRequestId}</title>`,
			this._getStyles(),
			"</head>",
			"<body>",
			'<div class="container">',
			this._getHeaderHtml(pr, sourceBranch, targetBranch, createdDate, createdTime, cacheInfo),
			this._getTabNavigationHtml(fileChanges, threads),
			'<div class="tab-content">',
			this._getConversationTabHtml(pr, descriptionHtml, threads),
			this._getFilesTabHtml(fileChanges, threads),
			"</div>",
			"</div>",
			this._getScripts(nonce),
			"</body>",
			"</html>",
		];

		return parts.join("");
	}

	/**
	 * Handle review submission from the webview
	 */
	private async _handleReviewSubmission(vote: number) {
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Submitting your review...",
					cancellable: false,
				},
				async (progress) => {
					progress.report({ increment: 0 });

					// Get the current user
					const currentUser = await this.azureDevOpsClient.getCurrentUser();

					progress.report({ increment: 50 });

					// Submit the vote
					await this.azureDevOpsClient.createReviewerVote(
						this.pullRequest.repository.project.id,
						this.pullRequest.repository.id,
						this.pullRequest.pullRequestId,
						currentUser.id,
						vote,
					);

					progress.report({ increment: 100 });
				},
			);

			// Show success message based on vote type
			let voteMessage = "Your vote has been submitted";
			if (vote === 10) {
				voteMessage = "You approved this pull request";
			} else if (vote === 5) {
				voteMessage = "You approved this pull request with suggestions";
			} else if (vote === -5) {
				voteMessage = "Marked as waiting for author";
			} else if (vote === -10) {
				voteMessage = "You rejected this pull request";
			} else if (vote === 0) {
				voteMessage = "Your vote has been reset";
			}

			vscode.window.showInformationMessage(voteMessage);

			// Invalidate cache for this PR since the review state has changed
			const cache = PRCacheService.getInstance();
			cache.invalidate(
				this.pullRequest.repository.project.id,
				this.pullRequest.repository.id,
				this.pullRequest.pullRequestId,
			);

			// Refresh the panel to show updated reviewer status
			await this._update();
		} catch (error) {
			const friendlyMessage = this._getFriendlyErrorMessage(error);
			logger.error("Error submitting review:", error);
			vscode.window.showErrorMessage(`Failed to submit review: ${friendlyMessage}`);
		}
	}

	/**
	 * Handle toggling the reviewed state of a file
	 */
	private async _handleToggleReviewed(filePath: string) {
		if (!PullRequestViewerPanel._reviewedFilesService) {
			logger.warn("ReviewedFilesService not available");
			return;
		}

		try {
			const projectId = this.pullRequest.repository.project.id;
			const repositoryId = this.pullRequest.repository.id;
			const prId = this.pullRequest.pullRequestId;

			// Normalize path to match the format used in file list rendering
			let normalizedPath = filePath;
			if (!normalizedPath.startsWith("/")) {
				normalizedPath = `/${normalizedPath}`;
			}

			// Toggle the reviewed state
			const newState = await PullRequestViewerPanel._reviewedFilesService.toggleFileReviewed(
				projectId,
				repositoryId,
				prId,
				normalizedPath,
			);

			// Send updated state back to webview for dynamic UI update
			this._panel.webview.postMessage({
				command: "fileReviewedStateChanged",
				filePath: filePath,
				reviewed: newState,
			});

			logger.debug(`Toggled reviewed state for ${normalizedPath}: ${newState}`);
		} catch (error) {
			logger.error("Error toggling reviewed state:", error);
		}
	}

	/**
	 * Handle reply to a thread from webview
	 */
	private async _handleReplyToThread(threadId: number, content: string): Promise<void> {
		try {
			if (!content.trim()) {
				this._sendMessageToWebview({ type: "error", message: "Reply cannot be empty" });
				return;
			}

			await this.azureDevOpsClient.replyToPRThread(
				this.pullRequest.repository.project.id,
				this.pullRequest.repository.id,
				this.pullRequest.pullRequestId,
				threadId,
				content,
			);

			// Refresh the view to show the new reply
			await this.refreshWithFreshData();
			this._sendMessageToWebview({ type: "success", message: "Reply added successfully" });
		} catch (error) {
			logger.error("Failed to reply to thread", error);
			this._sendMessageToWebview({ type: "error", message: "Failed to add reply" });
		}
	}

	/**
	 * Handle edit comment from webview
	 */
	private async _handleEditComment(
		threadId: number,
		commentId: number,
		content: string,
	): Promise<void> {
		try {
			if (!content.trim()) {
				this._sendMessageToWebview({ type: "error", message: "Comment cannot be empty" });
				return;
			}

			await this.azureDevOpsClient.updateComment(
				this.pullRequest.repository.project.id,
				this.pullRequest.repository.id,
				this.pullRequest.pullRequestId,
				threadId,
				commentId,
				content,
			);

			await this.refreshWithFreshData();
			this._sendMessageToWebview({ type: "success", message: "Comment updated successfully" });
		} catch (error) {
			logger.error("Failed to edit comment", error);
			this._sendMessageToWebview({ type: "error", message: "Failed to update comment" });
		}
	}

	/**
	 * Handle delete comment from webview
	 */
	private async _handleDeleteComment(threadId: number, commentId: number): Promise<void> {
		try {
			await this.azureDevOpsClient.deleteComment(
				this.pullRequest.repository.project.id,
				this.pullRequest.repository.id,
				this.pullRequest.pullRequestId,
				threadId,
				commentId,
			);

			await this.refreshWithFreshData();
			this._sendMessageToWebview({ type: "success", message: "Comment deleted successfully" });
		} catch (error) {
			logger.error("Failed to delete comment", error);
			this._sendMessageToWebview({ type: "error", message: "Failed to delete comment" });
		}
	}

	/**
	 * Handle resolve thread from webview
	 */
	private async _handleResolveThread(threadId: number): Promise<void> {
		try {
			await this.azureDevOpsClient.updateThreadStatus(
				this.pullRequest.repository.project.id,
				this.pullRequest.repository.id,
				this.pullRequest.pullRequestId,
				threadId,
				2, // THREAD_STATUS.RESOLVED
			);

			await this.refreshWithFreshData();
			this._sendMessageToWebview({ type: "success", message: "Thread resolved" });
		} catch (error) {
			logger.error("Failed to resolve thread", error);
			this._sendMessageToWebview({ type: "error", message: "Failed to resolve thread" });
		}
	}

	/**
	 * Handle unresolve thread from webview
	 */
	private async _handleUnresolveThread(threadId: number): Promise<void> {
		try {
			await this.azureDevOpsClient.updateThreadStatus(
				this.pullRequest.repository.project.id,
				this.pullRequest.repository.id,
				this.pullRequest.pullRequestId,
				threadId,
				1, // THREAD_STATUS.ACTIVE
			);

			await this.refreshWithFreshData();
			this._sendMessageToWebview({ type: "success", message: "Thread reopened" });
		} catch (error) {
			logger.error("Failed to unresolve thread", error);
			this._sendMessageToWebview({ type: "error", message: "Failed to reopen thread" });
		}
	}

	/**
	 * Send message to webview
	 */
	private _sendMessageToWebview(message: { type: string; message: string }): void {
		this._panel.webview.postMessage(message);
	}

	/**
	 * Open a file in diff view showing changes between base and modified versions
	 *
	 * CRITICAL METHOD - This creates virtual documents with the "azdo-pr" scheme
	 * which is essential for inline comment display to work correctly.
	 *
	 * The "azdo-pr" URI scheme is used to:
	 * 1. Identify PR diff documents vs regular files
	 * 2. Trigger comment loading via event listeners in extension.ts
	 * 3. Associate documents with PR context for commenting
	 *
	 * Flow for inline comments:
	 * 1. This method creates URIs with scheme "azdo-pr" (lines 510-515)
	 * 2. VS Code opens the diff view with these virtual documents
	 * 3. Event listeners in extension.ts detect the "azdo-pr" scheme
	 * 4. PRCommentController.loadCommentsForDocument() is called
	 * 5. Comments appear inline in the diff view
	 *
	 * DO NOT CHANGE the URI scheme without updating:
	 * - extension.ts event listeners (onDidOpenTextDocument, onDidChangeActiveTextEditor)
	 * - PRCommentController.loadCommentsForDocument() scheme check
	 * - PRCommentController.commentingRangeProvider scheme check
	 */
	private async _openFileDiff(path: string, changeType: string, originalPath?: string) {
		try {
			logger.debug(
				`Opening file diff: ${path} changeType: ${changeType} originalPath: ${originalPath}`,
			);
			vscode.window.setStatusBarMessage(`Loading diff for ${path}...`, 3000);

			const isAdded = changeType.includes("add");
			const isDeleted = changeType.includes("delete");
			const isRenamed = changeType.includes("rename");

			// Check if file is potentially an LFS file (by extension)
			const potentiallyLfs = this._isPotentiallyLfsFile(path);

			if (potentiallyLfs) {
				// Try to handle as LFS file
				const handled = await this._handleLfsFile(path, changeType, originalPath);
				if (handled) {
					return; // Successfully handled as LFS file
				}
				// Fall through to normal handling if LFS handling failed
			}

			// Get branch names for display in URIs
			const sourceBranch = this.pullRequest.sourceRefName
				? this.pullRequest.sourceRefName.replace("refs/heads/", "")
				: "unknown";
			const targetBranch = this.pullRequest.targetRefName
				? this.pullRequest.targetRefName.replace("refs/heads/", "")
				: "unknown";

			// Get commit SHAs or branch names for fetching files
			// Prefer commit SHAs (more reliable), but fall back to branch names if not available
			let sourceVersion = this.pullRequest.lastMergeSourceCommit?.commitId;
			let targetVersion = this.pullRequest.lastMergeTargetCommit?.commitId;

			if (!sourceVersion || !targetVersion) {
				logger.debug("[PRViewerPanel] Commit SHAs not available, falling back to branch names");
				sourceVersion = sourceBranch;
				targetVersion = targetBranch;
			}

			logger.debug("[PRViewerPanel] Version information:", {
				sourceVersion,
				targetVersion,
				usingCommitSHAs: !!this.pullRequest.lastMergeSourceCommit?.commitId,
			});

			// Fetch both versions of the file
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Fetching diff for ${path}...`,
					cancellable: false,
				},
				async (progress) => {
					progress.report({ increment: 0 });

					let baseContent = "";
					let modifiedContent = "";

					try {
						// Fetch base version (from target) unless file is added
						if (!isAdded) {
							progress.report({
								increment: 25,
								message: "Fetching base version...",
							});
							// Use originalPath for renamed files when fetching the base version
							const basePathToFetch = isRenamed && originalPath ? originalPath : path;
							try {
								baseContent = await this.azureDevOpsClient.getFileContent(
									this.pullRequest.repository.project.id,
									this.pullRequest.repository.id,
									basePathToFetch,
									targetVersion,
								);
							} catch (error) {
								// If base file doesn't exist (404), treat as new file (empty base content)
								// This handles cases where Azure DevOps reports changeType as "edit" for new files
								if (error instanceof Error && error.message.includes("File not found")) {
									logger.debug(
										`PRViewerPanel: Base file not found, treating as new file: ${basePathToFetch}`,
									);
									baseContent = "";
								} else {
									throw error;
								}
							}
						}

						// Fetch modified version (from source) unless file is deleted
						if (!isDeleted) {
							progress.report({
								increment: 50,
								message: "Fetching modified version...",
							});
							modifiedContent = await this.azureDevOpsClient.getFileContent(
								this.pullRequest.repository.project.id,
								this.pullRequest.repository.id,
								path,
								sourceVersion,
							);
						}

						progress.report({ increment: 75, message: "Opening diff view..." });

						// ================================================================
						// CRITICAL: Create virtual document URIs with "azdo-pr" scheme
						// This specific scheme is REQUIRED for inline comments to work!
						// Event listeners in extension.ts watch for this scheme to trigger
						// comment loading. DO NOT CHANGE "azdo-pr" without updating all
						// related event listeners and comment controller code.
						// ================================================================
						const prId = this.pullRequest.pullRequestId;
						const repoName = this.pullRequest.repository?.name || "unknown";
						const baseUri = vscode.Uri.parse(
							`azdo-pr:base/${prId}${path}?pr=${prId}&repo=${repoName}&branch=${targetBranch}`,
						);
						const modifiedUri = vscode.Uri.parse(
							`azdo-pr:modified/${prId}${path}?pr=${prId}&repo=${repoName}&branch=${sourceBranch}`,
						);

						// Register content provider if not already registered
						if (!PullRequestViewerPanel._contentProviderRegistered) {
							PullRequestViewerPanel._contentProviderRegistered = true;
							vscode.workspace.registerTextDocumentContentProvider("azdo-pr", {
								provideTextDocumentContent: (uri: vscode.Uri): string => {
									const cached = PullRequestViewerPanel._virtualFileCache.get(uri.toString());
									return cached ? cached.content : "";
								},
							});
						}

						// Cache the content for both versions with timestamps
						const now = Date.now();
						PullRequestViewerPanel._virtualFileCache.set(baseUri.toString(), {
							content: baseContent,
							timestamp: now,
							prId,
						});
						PullRequestViewerPanel._virtualFileCache.set(modifiedUri.toString(), {
							content: modifiedContent,
							timestamp: now,
							prId,
						});

						// Create title for diff view
						const fileName = path.split("/").pop() || path;
						let title = `${fileName} (PR #${prId})`;
						if (isAdded) {
							title = `${fileName} (Added in PR #${prId})`;
						} else if (isDeleted) {
							title = `${fileName} (Deleted in PR #${prId})`;
						} else if (isRenamed && originalPath) {
							const originalFileName = originalPath.split("/").pop() || originalPath;
							title = `${originalFileName} → ${fileName} (Renamed in PR #${prId})`;
						}

						// Associate both sides of the diff with the PR context for commenting
						// IMPORTANT: Set context BEFORE opening diff to avoid race condition
						const contextManager = PRContextManager.getInstance();

						// Base (left) side context
						const baseContext: PRFileContext = {
							pullRequest: this.pullRequest,
							filePath: path,
							side: "base",
							changeType: changeType,
						};
						contextManager.setPRFileContext(baseUri, baseContext);
						logger.debug(`PRViewerPanel: Set base context for: ${baseUri.toString()}`);

						// Modified (right) side context
						const modifiedContext: PRFileContext = {
							pullRequest: this.pullRequest,
							filePath: path,
							side: "modified",
							changeType: changeType,
						};
						contextManager.setPRFileContext(modifiedUri, modifiedContext);
						logger.debug(`PRViewerPanel: Set modified context for: ${modifiedUri.toString()}`);

						// Legacy support
						contextManager.setFileContext(modifiedUri.toString(), this.pullRequest);

						// Open diff view
						await vscode.commands.executeCommand("vscode.diff", baseUri, modifiedUri, title);

						// Mark file as reviewed
						if (PullRequestViewerPanel._reviewedFilesService) {
							// Normalize path to match the format used in file list rendering
							let normalizedPath = path;
							if (!normalizedPath.startsWith("/")) {
								normalizedPath = `/${normalizedPath}`;
							}
							await PullRequestViewerPanel._reviewedFilesService.markAsReviewed(
								this.pullRequest.repository.project.id,
								this.pullRequest.repository.id,
								this.pullRequest.pullRequestId,
								normalizedPath,
							);
							logger.debug(`Marked file as reviewed: ${normalizedPath}`);

							// Send message to webview to update UI dynamically
							this._panel.webview.postMessage({
								command: "fileReviewedStateChanged",
								filePath: path,
								reviewed: true,
							});
						}

						progress.report({ increment: 100 });
						logger.debug("Diff view opened successfully for:", path);
					} catch (error) {
						// Log the full error details for debugging
						logger.error(
							"[PRViewerPanel] Error fetching file content - Full error details:",
							error,
						);
						if (error instanceof Error) {
							logger.error("PRViewerPanel: Error message:", error.message);
							logger.error("PRViewerPanel: Error stack:", error.stack);
						}

						const friendlyMessage = this._getFriendlyErrorMessage(error);
						logger.error("PRViewerPanel: Friendly error message:", friendlyMessage);

						// Offer to view in browser as fallback
						const action = await vscode.window.showErrorMessage(
							`Failed to fetch file content: ${friendlyMessage}`,
							"View in Browser",
						);

						if (action === "View in Browser") {
							const org = vscode.workspace
								.getConfiguration("azureDevOpsPRViewer")
								.get<string>("organization", "");
							const projectName = this.pullRequest.repository?.project?.name || "unknown";
							const repoName = this.pullRequest.repository?.name || "unknown";
							const webUrl = `https://dev.azure.com/${org}/${projectName}/_git/${repoName}/pullrequest/${this.pullRequest.pullRequestId}?_a=files&path=${encodeURIComponent(path)}`;
							vscode.env.openExternal(vscode.Uri.parse(webUrl));
						}
					}
				},
			);
		} catch (error) {
			const friendlyMessage = this._getFriendlyErrorMessage(error);
			logger.error("Error opening file diff:", error);
			vscode.window.showErrorMessage(`Failed to open diff: ${friendlyMessage}`);
		}
	}

	/**
	 * Check if a file path is potentially an LFS file based on extension
	 */
	private _isPotentiallyLfsFile(path: string): boolean {
		const lfsExtensions = [
			".pdf",
			".doc",
			".docx",
			".ppt",
			".pptx",
			".xls",
			".xlsx",
			".png",
			".jpg",
			".jpeg",
			".gif",
			".bmp",
			".tiff",
			".ico",
			".mp4",
			".mov",
			".avi",
			".mkv",
			".webm",
			".mp3",
			".wav",
			".flac",
			".zip",
			".tar",
			".gz",
		];
		const lowerPath = path.toLowerCase();
		return lfsExtensions.some((ext) => lowerPath.endsWith(ext));
	}

	/**
	 * Handle LFS file display
	 * Returns true if successfully handled, false if should fall back to normal diff
	 */
	private async _handleLfsFile(
		path: string,
		changeType: string,
		_originalPath?: string,
	): Promise<boolean> {
		try {
			// Skip deleted files (can't preview them)
			if (changeType.includes("delete")) {
				vscode.window.showInformationMessage(`Deleted files cannot be previewed. File: ${path}`);
				return true; // Handled (by showing message)
			}

			const sourceVersion =
				this.pullRequest.lastMergeSourceCommit?.commitId ||
				this.pullRequest.sourceRefName.replace("refs/heads/", "");

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Downloading LFS file: ${path}...`,
					cancellable: false,
				},
				async (progress) => {
					progress.report({ increment: 10 });

					// Step 1: Fetch file content (might be LFS pointer)
					const content = await this.azureDevOpsClient.getFileContent(
						this.pullRequest.repository.project.id,
						this.pullRequest.repository.id,
						path,
						sourceVersion,
					);

					progress.report({ increment: 30 });

					// Step 2: Get LFS service instance
					const lfsService = this._getLfsService();

					// Step 3: Check if it's actually an LFS pointer
					if (!lfsService.isLfsPointer(content)) {
						logger.debug("[PRViewerPanel] File is not LFS, falling back to normal diff");
						return false; // Not LFS, use normal handling
					}

					logger.debug("[PRViewerPanel] Detected LFS pointer file");
					progress.report({ increment: 50, message: "Resolving LFS file..." });

					// Step 4: Download actual LFS content
					const lfsContent = await lfsService.downloadLfsFile(
						this.pullRequest.repository.project.id,
						this.pullRequest.repository.id,
						path,
						sourceVersion,
					);

					progress.report({ increment: 80, message: "Opening file..." });

					// Step 5: Get appropriate handler and display
					const handler = this._getFileHandlerRegistry().getHandler(path);
					if (!handler) {
						vscode.window.showWarningMessage(
							`No viewer available for ${path}. File type not yet supported.`,
						);
						return true; // Handled (by showing message)
					}

					const prContext: PRContext = {
						pullRequestId: this.pullRequest.pullRequestId,
						projectId: this.pullRequest.repository.project.id,
						repositoryId: this.pullRequest.repository.id,
						repositoryName: this.pullRequest.repository.name,
						filePath: path,
						version: sourceVersion,
					};

					await handler.displayFile(lfsContent, path, prContext);

					progress.report({ increment: 100 });
					return true; // Successfully handled
				},
			);

			return true;
		} catch (error) {
			logger.error("PRViewerPanel: LFS file handling failed:", error);
			vscode.window.showErrorMessage(
				`Failed to load LFS file: ${error instanceof Error ? error.message : String(error)}`,
			);
			return true; // Handled (by showing error)
		}
	}

	/**
	 * Get or create LFS service singleton
	 */
	private _getLfsService(): LfsService {
		if (!PullRequestViewerPanel._lfsService) {
			PullRequestViewerPanel._lfsService = new LfsService(
				this.azureDevOpsClient,
				this._getFileHandlerRegistry(),
			);
		}
		return PullRequestViewerPanel._lfsService;
	}

	/**
	 * Get or create file handler registry singleton
	 */
	private _getFileHandlerRegistry(): FileHandlerRegistry {
		if (!PullRequestViewerPanel._fileHandlerRegistry) {
			const registry = new FileHandlerRegistry();
			// Register handlers in order of specificity
			registry.register(new PdfFileHandler());
			// Future: registry.register(new ImageFileHandler());
			// Future: registry.register(new FallbackBinaryHandler());
			PullRequestViewerPanel._fileHandlerRegistry = registry;
		}
		return PullRequestViewerPanel._fileHandlerRegistry;
	}

	private _getStyles(): string {
		return `<style>
            * {
                box-sizing: border-box;
            }
            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 0;
                margin: 0;
                overflow-x: hidden;
            }
            .container {
                width: 100%;
                max-width: 100%;
                margin: 0;
                padding: 20px;
                overflow-x: hidden;
            }
            .header {
                padding-bottom: 10px;
                margin-bottom: 10px;
            }
            .header-top {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 20px;
                margin-bottom: 10px;
            }
            .pr-title {
                font-size: 24px;
                font-weight: 600;
                margin: 0;
                flex: 1;
            }
            .header-buttons {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .open-browser-btn, .refresh-btn {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 10px;
                background-color: transparent;
                color: var(--vscode-textLink-foreground);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 3px;
                cursor: pointer;
                font-size: 12px;
                white-space: nowrap;
                transition: all 0.2s;
            }
            .open-browser-btn:hover, .refresh-btn:hover {
                background-color: var(--vscode-list-hoverBackground);
                border-color: var(--vscode-textLink-foreground);
            }
            .open-browser-btn:active, .refresh-btn:active {
                background-color: var(--vscode-list-activeSelectionBackground);
            }
            .refresh-btn .btn-icon {
                font-size: 14px;
                line-height: 1;
            }
            .pr-meta {
                color: var(--vscode-descriptionForeground);
                font-size: 13px;
            }
            .pr-meta-secondary {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-top: 8px;
                color: var(--vscode-descriptionForeground);
                font-size: 12px;
            }
            .meta-item {
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .meta-label {
                font-weight: 500;
            }
            .meta-separator {
                color: var(--vscode-descriptionForeground);
                opacity: 0.5;
            }
            .branch-info {
                display: flex;
                align-items: center;
                gap: 10px;
                margin: 15px 0;
                font-family: var(--vscode-editor-font-family);
            }
            .branch {
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                padding: 4px 8px;
                border-radius: 3px;
                font-size: 12px;
            }
            .status-badge {
                display: inline-block;
                padding: 4px 8px;
                border-radius: 3px;
                font-size: 12px;
                font-weight: 500;
            }
            .status-active {
                background-color: var(--vscode-testing-iconPassed);
                color: var(--vscode-editor-background);
            }
            .status-draft {
                background-color: var(--vscode-descriptionForeground);
                color: var(--vscode-editor-background);
            }
            .metadata-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin: 20px 0;
                padding: 15px;
                background-color: var(--vscode-editorWidget-background);
                border-radius: 4px;
            }
            .metadata-item {
                display: flex;
                flex-direction: column;
            }
            .metadata-label {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
                margin-bottom: 5px;
            }
            .metadata-value {
                font-size: 14px;
                font-weight: 500;
            }
            .section {
                margin: 30px 0;
            }
            .review-section-wrapper {
                display: grid;
                grid-template-columns: minmax(250px, 320px) 1fr;
                gap: 15px;
                margin: 20px 0;
                align-items: start;
            }
            @media (max-width: 800px) {
                .review-section-wrapper {
                    grid-template-columns: 1fr;
                }
            }
            .section-title {
                font-size: 16px;
                font-weight: 600;
                margin: 0;
            }
            .section-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
                padding-bottom: 8px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            .reviewer-counts {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                white-space: nowrap;
            }
            .count-item {
                font-weight: 500;
            }
            .count-separator {
                color: var(--vscode-descriptionForeground);
                opacity: 0.5;
            }
            .description {
                padding: 10px;
                background-color: var(--vscode-editorWidget-background);
                border-radius: 4px;
                line-height: 1.6;
                word-wrap: break-word;
                overflow-wrap: break-word;
            }
            .description p {
                margin: 8px 0;
            }
            .description h1, .description h2, .description h3 {
                margin-top: 16px;
                margin-bottom: 8px;
                font-weight: 600;
            }
            .description h1 { font-size: 20px; }
            .description h2 { font-size: 18px; }
            .description h3 { font-size: 16px; }
            .description ul, .description ol {
                margin: 8px 0;
                padding-left: 25px;
            }
            .description li {
                margin: 4px 0;
            }
            .description code {
                background-color: var(--vscode-textCodeBlock-background);
                padding: 2px 4px;
                border-radius: 3px;
                font-family: var(--vscode-editor-font-family);
                font-size: 0.9em;
            }
            .description pre {
                background-color: var(--vscode-textCodeBlock-background);
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
                margin: 8px 0;
            }
            .description pre code {
                background-color: transparent;
                padding: 0;
            }
            .description blockquote {
                border-left: 3px solid var(--vscode-panel-border);
                padding-left: 10px;
                margin: 8px 0;
                color: var(--vscode-descriptionForeground);
            }
            .description a {
                color: var(--vscode-textLink-foreground);
                text-decoration: none;
            }
            .description a:hover {
                text-decoration: underline;
            }
            .file-list {
                list-style: none;
                padding: 0;
                margin: 0;
            }
            .file-item {
                padding: 10px;
                border-bottom: 1px solid var(--vscode-panel-border);
                display: flex;
                align-items: center;
                gap: 10px;
                cursor: pointer;
            }
            .file-item:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            .file-info {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 2px;
                min-width: 0;
            }
            .file-name {
                font-weight: 500;
                font-size: 13px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .file-dir-path {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                opacity: 0.8;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .comment-count-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 3px 8px;
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                border-radius: 12px;
                font-size: 11px;
                font-weight: 500;
                white-space: nowrap;
                margin-left: auto;
                flex-shrink: 0;
            }
            .reviewed-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                font-size: 12px;
                font-weight: bold;
                margin-left: 4px;
                cursor: pointer;
                flex-shrink: 0;
                transition: all 0.2s;
            }
            /* Reviewed state - filled green circle */
            .reviewed-badge.reviewed {
                background-color: var(--vscode-testing-iconPassed);
                color: white;
                border: 2px solid var(--vscode-testing-iconPassed);
            }
            /* Not reviewed state - outline only */
            .reviewed-badge.not-reviewed {
                background-color: transparent;
                color: var(--vscode-descriptionForeground);
                border: 2px solid var(--vscode-descriptionForeground);
                opacity: 0.5;
            }
            .reviewed-badge:hover {
                opacity: 1 !important;
                transform: scale(1.1);
            }
            .file-change-type {
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 3px;
                font-weight: 500;
            }
            .change-add {
                background-color: var(--vscode-gitDecoration-addedResourceForeground);
                color: var(--vscode-editor-background);
            }
            .change-edit {
                background-color: var(--vscode-gitDecoration-modifiedResourceForeground);
                color: var(--vscode-editor-background);
            }
            .change-delete {
                background-color: var(--vscode-gitDecoration-deletedResourceForeground);
                color: var(--vscode-editor-background);
            }
            .change-rename {
                background-color: var(--vscode-gitDecoration-renamedResourceForeground);
                color: var(--vscode-editor-background);
            }
            .empty-state {
                padding: 40px;
                text-align: center;
                color: var(--vscode-descriptionForeground);
            }
            .reviewer-list {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
            }
            .reviewer {
                display: flex;
                align-items: center;
                gap: 5px;
                padding: 5px 10px;
                background-color: var(--vscode-editorWidget-background);
                border-radius: 3px;
                font-size: 13px;
            }
            .vote-icon {
                font-weight: bold;
            }
            .vote-approved {
                color: var(--vscode-testing-iconPassed);
            }
            .vote-rejected {
                color: var(--vscode-testing-iconFailed);
            }
            .vote-waiting {
                color: var(--vscode-descriptionForeground);
            }
            .review-actions-section {
                background-color: var(--vscode-editorWidget-background);
                padding: 10px;
                border-radius: 4px;
                margin: 0;
            }
            .review-actions {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .review-action-btn {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 4px 8px;
                border: 1px solid transparent;
                border-radius: 3px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                transition: all 0.15s ease;
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }
            .review-action-btn:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
                border-color: var(--vscode-focusBorder);
                transform: translateY(-1px);
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            }
            .review-action-btn:active {
                transform: translateY(0);
                box-shadow: none;
            }
            .approve-btn {
                background-color: var(--vscode-testing-iconPassed);
                color: white;
            }
            .approve-btn:hover {
                filter: brightness(1.1);
            }
            .approve-suggestions-btn {
                background-color: #4a9eff;
                color: white;
            }
            .approve-suggestions-btn:hover {
                filter: brightness(1.1);
            }
            .reject-btn {
                background-color: var(--vscode-testing-iconFailed);
                color: white;
            }
            .reject-btn:hover {
                filter: brightness(1.1);
            }
            .waiting-btn {
                background-color: #ffa500;
                color: white;
            }
            .waiting-btn:hover {
                filter: brightness(1.1);
            }
            .btn-icon {
                font-size: 11px;
                line-height: 1;
            }
            .reviews-combined-section {
                background-color: var(--vscode-editorWidget-background);
                padding: 12px;
                border-radius: 4px;
                overflow-x: hidden;
            }
            .reviews-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
                padding-bottom: 10px;
                gap: 10px;
            }
            .review-subsection {
                margin-top: 12px;
                padding-top: 12px;
                border-top: 1px solid var(--vscode-panel-border);
            }
            .review-subsection:first-of-type {
                border-top: none;
                margin-top: 0;
                padding-top: 0;
            }
            .subsection-title {
                font-size: 12px;
                font-weight: 600;
                margin: 0 0 8px 0;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .reviewers-section {
                background-color: var(--vscode-editorWidget-background);
                padding: 10px;
                border-radius: 4px;
                overflow-x: hidden;
            }
            .reviewers-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
                gap: 10px;
            }
            .reviewer-list-detailed {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .reviewer-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 6px 8px;
                background-color: var(--vscode-editor-background);
                border-radius: 3px;
                border: 1px solid var(--vscode-panel-border);
                gap: 8px;
                min-width: 0;
            }
            .reviewer-info {
                display: flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
                flex: 1;
            }
            .reviewer-name {
                font-weight: 500;
                font-size: 11px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
                flex-shrink: 1;
            }
            .reviewer-vote {
                display: flex;
                align-items: center;
                gap: 4px;
                flex-shrink: 0;
            }
            .vote-text {
                font-size: 10px;
            }
            .required-badge {
                display: inline-block;
                padding: 1px 4px;
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                border-radius: 2px;
                font-size: 9px;
                font-weight: 600;
                text-transform: uppercase;
                flex-shrink: 0;
            }
            .vote-approved-suggestions {
                color: #4a9eff;
            }
            .vote-waiting-author {
                color: #ffa500;
            }
            .tab-navigation {
                display: flex;
                border-bottom: 1px solid var(--vscode-panel-border);
                margin: 20px 0 0 0;
                gap: 4px;
            }
            .tab-button {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 10px 16px;
                background: transparent;
                border: none;
                border-bottom: 2px solid transparent;
                color: var(--vscode-descriptionForeground);
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.2s;
                position: relative;
            }
            .tab-button:hover {
                color: var(--vscode-foreground);
                background-color: var(--vscode-list-hoverBackground);
            }
            .tab-button.active {
                color: var(--vscode-foreground);
                border-bottom-color: var(--vscode-textLink-foreground);
            }
            .tab-icon {
                font-size: 16px;
                line-height: 1;
            }
            .tab-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 20px;
                height: 20px;
                padding: 0 6px;
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                border-radius: 10px;
                font-size: 11px;
                font-weight: 600;
            }
            .tab-content {
                margin-top: 0;
            }
            .tab-panel {
                display: none;
                animation: fadeIn 0.2s ease-in;
            }
            .tab-panel.active {
                display: block;
            }
            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: translateY(-4px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            .conversation-layout {
                display: grid;
                grid-template-columns: minmax(250px, 320px) 1fr;
                gap: 20px;
                margin: 20px 0;
                align-items: start;
            }
            @media (max-width: 900px) {
                .conversation-layout {
                    grid-template-columns: 1fr;
                }
            }
            .conversation-sidebar {
                position: sticky;
                top: 20px;
            }
            .conversation-main {
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            .content-grid {
                display: grid;
                grid-template-columns: minmax(400px, 1fr) minmax(300px, 450px);
                gap: 20px;
                margin: 20px 0;
                align-items: start;
            }
            @media (max-width: 1000px) {
                .content-grid {
                    grid-template-columns: 1fr;
                }
            }
            .file-changes-section {
                min-width: 0;
                padding: 20px 0;
            }
            .file-changes-section .file-list {
                border: 1px solid var(--vscode-panel-border);
                border-radius: 6px;
                overflow: hidden;
            }
            .file-changes-section .file-item {
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            .file-changes-section .file-item:last-child {
                border-bottom: none;
            }
            .description-section {
                background-color: var(--vscode-editorWidget-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 6px;
                padding: 16px;
            }
            .general-comments-section {
                min-width: 0;
            }
            .general-comments-section .section-title {
                margin-bottom: 12px;
                font-size: 16px;
            }
            .general-comments-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .general-comment-thread {
                background-color: var(--vscode-editorWidget-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                padding: 12px;
            }
            .comment-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
                padding-bottom: 8px;
  
            }
            .comment-header-left {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
                min-width: 0;
            }
            .comment-header-right {
                flex-shrink: 0;
            }
            .comment-author {
                font-weight: 600;
                font-size: 13px;
                color: var(--vscode-foreground);
                flex-shrink: 0;
            }
            .comment-meta {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
            }
            .comment-time {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                white-space: nowrap;
            }
            .comment-time::before {
                content: "•";
                margin-right: 8px;
                color: var(--vscode-descriptionForeground);
                opacity: 0.5;
            }
            .comment-status-badge {
                display: inline-block;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 500;
                text-transform: uppercase;
                white-space: nowrap;
            }
            .status-badge-resolved {
                background-color: var(--vscode-testing-iconPassed);
                color: white;
            }
            .status-badge-wontfix {
                background-color: var(--vscode-descriptionForeground);
                color: white;
            }
            .status-badge-pending {
                background-color: #ffa500;
                color: white;
            }
            .status-badge-unknown {
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
            }
            .comment-body {
                font-size: 13px;
                line-height: 1.5;
                color: var(--vscode-foreground);
                white-space: pre-wrap;
                word-wrap: break-word;
                overflow-wrap: break-word;
            }
            .comment-body a {
                color: var(--vscode-textLink-foreground);
                text-decoration: none;
            }
            .comment-body a:hover {
                text-decoration: underline;
                color: var(--vscode-textLink-activeForeground);
            }
            .comment-body code {
                font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
                font-size: 0.9em;
                background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.15));
                padding: 2px 4px;
                border-radius: 3px;
            }
            .comment-body pre {
                font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
                font-size: 0.9em;
                background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.15));
                padding: 8px 12px;
                border-radius: 4px;
                overflow-x: auto;
                white-space: pre;
                margin: 8px 0;
            }
            .comment-body pre code {
                background: transparent;
                padding: 0;
            }
            .comment-body strong, .comment-body b {
                font-weight: 600;
            }
            .comment-body em, .comment-body i {
                font-style: italic;
            }
            .comment-body p {
                margin: 0 0 8px 0;
            }
            .comment-body p:last-child {
                margin-bottom: 0;
            }
            .comment-reply-count {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid var(--vscode-panel-border);
                font-weight: 500;
            }
            .comment-replies {
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid var(--vscode-panel-border);
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .comment-reply {
                padding: 8px;
                background-color: var(--vscode-editor-background);
                border-radius: 3px;
                border-left: 2px solid var(--vscode-panel-border);
            }
            .comment-reply-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 4px;
                gap: 8px;
            }
            .comment-reply .comment-author {
                font-size: 12px;
                font-weight: 500;
            }
            .comment-reply .comment-body {
                font-size: 12px;
            }

            /* Notification items - activity log style, not comments */
            .notification-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            .notification-item:last-child {
                border-bottom: none;
            }
            .notification-icon {
                font-size: 14px;
                opacity: 0.7;
            }
            .notification-text {
                flex: 1;
            }
            .notification-time {
                font-size: 11px;
                opacity: 0.7;
            }

            /* Interactive comment styles */
            .thread-actions {
                display: flex;
                gap: 8px;
            }
            .thread-action-btn, .reply-toggle-btn, .submit-reply-btn, .cancel-reply-btn {
                padding: 4px 12px;
                font-size: 12px;
                border: 1px solid var(--vscode-button-border);
                border-radius: 4px;
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
                cursor: pointer;
            }
            .thread-action-btn:hover, .reply-toggle-btn:hover {
                background: var(--vscode-button-secondaryHoverBackground);
            }
            .submit-reply-btn {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            .submit-reply-btn:hover {
                background: var(--vscode-button-hoverBackground);
            }
            .reply-section {
                margin-top: 12px;
                border-top: 1px solid var(--vscode-panel-border);
                padding-top: 12px;
            }
            .reply-form {
                margin-top: 8px;
            }
            .reply-textarea {
                width: 100%;
                padding: 8px;
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                resize: vertical;
                box-sizing: border-box;
            }
            .reply-form-actions {
                display: flex;
                gap: 8px;
                margin-top: 8px;
                justify-content: flex-end;
            }
            .comment-actions {
                display: flex;
                gap: 8px;
                margin-top: 12px;
                opacity: 0;
                transition: opacity 0.15s ease-in-out;
            }
            .general-comment-thread:hover > .comment-actions,
            .comment-reply:hover > .comment-actions {
                opacity: 1;
            }
            .edit-comment-btn, .delete-comment-btn {
                padding: 2px 8px;
                font-size: 11px;
                border: 1px solid var(--vscode-button-border);
                border-radius: 3px;
                background: transparent;
                color: var(--vscode-foreground);
                cursor: pointer;
                opacity: 0.7;
                transition: opacity 0.1s ease-in-out, background 0.1s ease-in-out;
            }
            .edit-comment-btn:hover, .delete-comment-btn:hover {
                opacity: 1;
                background: var(--vscode-button-secondaryBackground);
            }
            .delete-comment-btn:hover {
                background: var(--vscode-errorForeground);
                color: white;
            }
            .comment-header-right {
                display: flex;
                align-items: center;
                gap: 8px;
            }
        </style>`;
	}

	/**
	 * Get the tab navigation HTML
	 */
	private _getTabNavigationHtml(fileChanges: PRFileChange[], threads: PRThread[]): string {
		const fileCount = fileChanges.filter((c) => !c.item.isFolder).length;
		const generalCommentCount = threads.filter(
			(thread) => !thread.threadContext?.filePath && !this._isVoteNotification(thread),
		).length;

		return `
        <div class="tab-navigation">
            <button class="tab-button active" data-tab="conversation">
                <span class="tab-icon">💬</span>
                Conversation
                ${generalCommentCount > 0 ? `<span class="tab-badge">${generalCommentCount}</span>` : ""}
            </button>
            <button class="tab-button" data-tab="files">
                <span class="tab-icon">📄</span>
                Files Changed
                <span class="tab-badge">${fileCount}</span>
            </button>
        </div>`;
	}

	/**
	 * Get the conversation tab content
	 */
	private _getConversationTabHtml(
		pr: PullRequest,
		descriptionHtml: string,
		threads: PRThread[],
	): string {
		return `
        <div class="tab-panel active" data-panel="conversation">
            <div class="conversation-layout">
                <div class="conversation-sidebar">
                    ${this._getCombinedReviewsHtml(pr)}
                </div>
                <div class="conversation-main">
                    ${this._getDescriptionHtml(descriptionHtml)}
                    ${this._getGeneralCommentsHtml(threads)}
                </div>
            </div>
        </div>`;
	}

	/**
	 * Get the files tab content
	 */
	private _getFilesTabHtml(fileChanges: PRFileChange[], threads: PRThread[]): string {
		return `
        <div class="tab-panel" data-panel="files">
            ${this._getFileChangesHtml(fileChanges, threads)}
        </div>`;
	}

	private _getHeaderHtml(
		pr: PullRequest,
		sourceBranch: string,
		targetBranch: string,
		createdDate: string,
		createdTime: string,
		cacheInfo: { isCached: boolean; ageInSeconds?: number },
	): string {
		const statusClass = pr.isDraft ? "status-draft" : "status-active";
		const statusText = pr.isDraft ? "draft" : pr.status;

		// Build the PR URL
		const org = vscode.workspace
			.getConfiguration("azureDevOpsPRViewer")
			.get<string>("organization", "");
		const prUrl = `https://dev.azure.com/${org}/${pr.repository?.project?.name || "unknown"}/_git/${pr.repository?.name || "unknown"}/pullrequest/${pr.pullRequestId}`;

		// Build refresh button tooltip with cache status
		let refreshTooltip = "Refresh PR data";
		if (cacheInfo.isCached && cacheInfo.ageInSeconds !== undefined) {
			const minutes = Math.floor(cacheInfo.ageInSeconds / 60);
			const seconds = cacheInfo.ageInSeconds % 60;
			if (minutes > 0) {
				refreshTooltip = `Cached ${minutes}m ${seconds}s ago - Click to refresh`;
			} else {
				refreshTooltip = `Cached ${seconds}s ago - Click to refresh`;
			}
		} else if (!cacheInfo.isCached) {
			refreshTooltip = "Fresh data loaded - Click to refresh";
		}

		return `
        <div class="header">
            <div class="header-top">
                <h1 class="pr-title">
                    ${this._escapeHtml(pr.title || "Untitled PR")}
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </h1>
                <div class="header-buttons">
                    <button class="refresh-btn" title="${this._escapeHtml(refreshTooltip)}">
                        <span class="btn-icon">↻</span>
                        Refresh
                    </button>
                    <button class="open-browser-btn" data-url="${this._escapeHtml(prUrl)}" title="Open PR in Azure DevOps">
                        Open in Browser
                    </button>
                </div>
            </div>
            <div class="pr-meta">
                #${pr.pullRequestId} opened on ${createdDate} at ${createdTime} by ${this._escapeHtml(pr.createdBy?.displayName || "[User name unavailable]")}
            </div>
            <div class="pr-meta-secondary">
                <span class="meta-item">
                    <span class="meta-label">Repository:</span> ${this._escapeHtml(pr.repository?.name) || "[Repository name unavailable]"}
                </span>
                <span class="meta-separator">•</span>
                <span class="meta-item">
                    <span class="meta-label">Project:</span> ${this._escapeHtml(pr.repository?.project?.name) || "[Project name unavailable]"}
                </span>
            </div>
            <div class="branch-info">
                <span class="branch">${this._escapeHtml(sourceBranch)}</span>
                <span>→</span>
                <span class="branch">${this._escapeHtml(targetBranch)}</span>
            </div>
        </div>`;
	}

	private _getCombinedReviewsHtml(pr: PullRequest): string {
		// Calculate vote counts
		const approvedCount = pr.reviewers?.filter((r) => r.vote === 10).length || 0;
		const approvedWithSuggestionsCount = pr.reviewers?.filter((r) => r.vote === 5).length || 0;
		const rejectedCount = pr.reviewers?.filter((r) => r.vote === -10).length || 0;
		const waitingCount = pr.reviewers?.filter((r) => r.vote === 0).length || 0;

		// Build reviewer items
		let reviewerItems =
			'<div class="empty-state" style="padding: 15px; text-align: center;">No reviewers assigned</div>';

		if (pr.reviewers && pr.reviewers.length > 0) {
			// Sort reviewers: required reviewers first, then by name
			const sortedReviewers = [...pr.reviewers].sort((a, b) => {
				// Required reviewers come first
				if (a.isRequired && !b.isRequired) return -1;
				if (!a.isRequired && b.isRequired) return 1;
				// Otherwise sort alphabetically by display name
				const nameA = a.displayName || a.uniqueName || "";
				const nameB = b.displayName || b.uniqueName || "";
				return nameA.localeCompare(nameB);
			});

			reviewerItems = sortedReviewers
				.map((reviewer) => {
					let voteIcon = "○";
					let voteClass = "vote-waiting";
					let voteText = "No vote";

					if (reviewer.vote === 10) {
						voteIcon = "✓";
						voteClass = "vote-approved";
						voteText = "Approved";
					} else if (reviewer.vote === 5) {
						voteIcon = "✓";
						voteClass = "vote-approved-suggestions";
						voteText = "Approved with suggestions";
					} else if (reviewer.vote === -5) {
						voteIcon = "⏸";
						voteClass = "vote-waiting-author";
						voteText = "Waiting for author";
					} else if (reviewer.vote === -10) {
						voteIcon = "✗";
						voteClass = "vote-rejected";
						voteText = "Rejected";
					}

					const requiredBadge = reviewer.isRequired
						? '<span class="required-badge">Required</span>'
						: "";

					return `
					<div class="reviewer-item">
						<div class="reviewer-info">
							<span class="reviewer-name">${this._escapeHtml(reviewer.displayName || reviewer.uniqueName || "[Reviewer name unavailable]")}</span>
							${requiredBadge}
						</div>
						<div class="reviewer-vote">
							<span class="vote-icon ${voteClass}">${voteIcon}</span>
							<span class="vote-text ${voteClass}">${voteText}</span>
						</div>
					</div>`;
				})
				.join("");
		}

		return `
        <div class="reviews-combined-section">
            <div class="reviews-header">
                <h3 class="section-title" style="font-size: 14px;">Reviews (${pr.reviewers?.length || 0})</h3>
                <div class="reviewer-counts">
                    <span class="count-item vote-approved">✓ ${approvedCount + approvedWithSuggestionsCount}</span>
                    <span class="count-separator">•</span>
                    <span class="count-item vote-rejected">✗ ${rejectedCount}</span>
                    <span class="count-separator">•</span>
                    <span class="count-item vote-waiting">○ ${waitingCount}</span>
                </div>
            </div>

            <div class="review-subsection">
                <h4 class="subsection-title">Your Review</h4>
                <div class="review-actions">
                    <button class="review-action-btn approve-btn" data-action="approve" data-vote="10">
                        <span class="btn-icon">✓</span>
                        <span class="btn-text">Approve</span>
                    </button>
                    <button class="review-action-btn approve-suggestions-btn" data-action="approve-suggestions" data-vote="5">
                        <span class="btn-icon">✓</span>
                        <span class="btn-text">Approve with Suggestions</span>
                    </button>
                    <button class="review-action-btn waiting-btn" data-action="waiting" data-vote="-5">
                        <span class="btn-icon">⏸</span>
                        <span class="btn-text">Wait for Author</span>
                    </button>
                    <button class="review-action-btn reject-btn" data-action="reject" data-vote="-10">
                        <span class="btn-icon">✗</span>
                        <span class="btn-text">Reject</span>
                    </button>
                    <button class="review-action-btn reset-btn" data-action="reset" data-vote="0">
                        <span class="btn-icon">↺</span>
                        <span class="btn-text">Reset Vote</span>
                    </button>
                </div>
            </div>

            <div class="review-subsection">
                <h4 class="subsection-title">All Reviewers</h4>
                <div class="reviewer-list-detailed">
                    ${reviewerItems}
                </div>
            </div>
        </div>`;
	}

	private _getDescriptionHtml(descriptionHtml: string): string {
		return (
			'<div class="description-section">' +
			'<h3 class="section-title" style="margin-bottom: 12px; font-size: 16px;">Description</h3>' +
			'<div class="description">' +
			descriptionHtml +
			"</div>" +
			"</div>"
		);
	}

	/**
	 * Count the number of comments per file from PR threads
	 * Only counts inline comments (those with specific line numbers)
	 * File-level comments (without line numbers) are excluded and shown in Conversation tab
	 * @param threads Array of PR threads
	 * @returns Map of file path to comment count
	 */
	private _countCommentsPerFile(threads: PRThread[]): Map<string, number> {
		const commentCounts = new Map<string, number>();

		for (const thread of threads) {
			// Only count threads that have a file context and at least one comment
			if (thread.threadContext?.filePath && thread.comments && thread.comments.length > 0) {
				// Skip file-level comments (those without specific line positions)
				// These should only appear in the Conversation tab
				const hasLinePosition =
					thread.threadContext.leftFileStart?.line || thread.threadContext.rightFileStart?.line;
				if (!hasLinePosition) {
					logger.debug(
						`[PRViewerPanel] Excluding file-level comment (thread ${thread.id}) from file badge count`,
					);
					continue;
				}

				let filePath = thread.threadContext.filePath;

				// Normalize path - ensure it starts with /
				if (!filePath.startsWith("/")) {
					filePath = `/${filePath}`;
				}

				const currentCount = commentCounts.get(filePath) || 0;
				// Count all comments in the thread
				commentCounts.set(filePath, currentCount + thread.comments.length);
			}
		}

		logger.debug("[PRViewerPanel] Comment counts per file:", Object.fromEntries(commentCounts));
		return commentCounts;
	}

	/**
	 * Check if a thread is a vote notification (system-generated vote comment)
	 */
	private _isVoteNotification(thread: PRThread): boolean {
		if (!thread.comments || thread.comments.length === 0) {
			return false;
		}

		const firstComment = thread.comments[0];
		const content = firstComment.content || "";

		// Check for common vote notification patterns
		const votePatterns = [
			/voted\s+(-?\d+)/i, // "voted -5", "voted 10"
			/changed\s+their\s+vote/i, // "changed their vote"
			/reset\s+their\s+vote/i, // "reset their vote"
		];

		return votePatterns.some((pattern) => pattern.test(content));
	}

	/**
	 * Check if a thread is a notification comment (system-generated, not user discussion)
	 * These include reviewer joins/leaves, policy updates, build status, etc.
	 */
	private _isNotificationComment(thread: PRThread): boolean {
		if (!thread.comments || thread.comments.length === 0) {
			return false;
		}

		const firstComment = thread.comments[0];

		// Check commentType (2 = system)
		if (firstComment.commentType === 2) {
			return true;
		}

		// Check for system author names
		const authorName = firstComment.author?.displayName || '';
		const systemAuthorPatterns = [
			/Microsoft\.VisualStudio\.Services/i,
			/^TFS$/i,
			/Azure DevOps/i,
			/^\[?System\]?$/i,
		];
		if (systemAuthorPatterns.some(pattern => pattern.test(authorName))) {
			return true;
		}

		// Check content patterns for notification-style messages
		const content = firstComment.content || '';
		const notificationPatterns = [
			/joined as a reviewer/i,
			/left as a reviewer/i,
			/was added as a reviewer/i,
			/was removed as a reviewer/i,
			/Policy status/i,
			/policy has been/i,
			/Build status/i,
			/build succeeded/i,
			/build failed/i,
			/check has (passed|failed|succeeded)/i,
			/status has been updated/i,
			/marked .* as (draft|ready for review)/i,
		];
		if (notificationPatterns.some(pattern => pattern.test(content))) {
			return true;
		}

		return false;
	}

	/**
	 * Get HTML for general PR comments and file-level comments
	 * Includes:
	 * 1. Threads without a file path (general PR comments)
	 * 2. Threads with a file path but no line numbers (file-level comments)
	 */
	private _getGeneralCommentsHtml(threads: PRThread[]): string {
		// Filter for general comments (no file path) and file-level comments (has file path but no line number)
		const generalThreads = threads.filter((thread) => {
			// Exclude vote notifications
			if (this._isVoteNotification(thread)) {
				return false;
			}

			// Include if no file path (general PR comment)
			if (!thread.threadContext?.filePath) {
				return true;
			}

			// Include if has file path but no line number (file-level comment)
			const hasLinePosition =
				thread.threadContext.leftFileStart?.line || thread.threadContext.rightFileStart?.line;
			return !hasLinePosition;
		});

		if (generalThreads.length === 0) {
			return `
            <div class="general-comments-section">
                <h3 class="section-title">General Comments</h3>
                <div class="empty-state" style="padding: 30px 20px; text-align: center; background-color: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px;">
                    No general comments on this PR
                </div>
            </div>`;
		}

		// Sort threads by last updated date (newest first)
		const sortedThreads = [...generalThreads].sort(
			(a, b) => b.lastUpdatedDate.getTime() - a.lastUpdatedDate.getTime(),
		);

		const threadItems = sortedThreads
			.map((thread) => {
				if (!thread.comments || thread.comments.length === 0) {
					return "";
				}

				const firstComment = thread.comments[0];
				const authorName = firstComment.author?.displayName || "[Author name unavailable]";
				const rawContent = firstComment.content || "[No content]";
				const content = cleanCommentContent(rawContent);
				const replyCount = thread.comments.length - 1;

				// Check if current user can edit this comment
				const canEditFirstComment =
					this.currentUserId && firstComment.author?.id === this.currentUserId;

				// Check if this is a notification comment (system-generated)
				const isNotification = this._isNotificationComment(thread);

				// For notification comments, render as simple activity item
				if (isNotification) {
					const timeAgo = formatTimeAgo(thread.lastUpdatedDate);
					const notificationText = content.replace(/<[^>]*>/g, '').trim(); // Strip any HTML
					return `
						<div class="notification-item">
							<span class="notification-icon">📋</span>
							<span class="notification-text">${this._escapeHtml(notificationText)}</span>
							<span class="notification-time">${timeAgo}</span>
						</div>`;
				}

				// Get status info - only show badge for meaningful statuses
				const statusLabel = getThreadStatusLabel(thread.status);
				const statusNum =
					typeof thread.status === "string" ? Number.parseInt(thread.status, 10) : thread.status;
				const isResolved = statusNum === 2 || statusNum === 4;
				let statusBadge = "";

				// Only show status badges for specific non-active states
				if (
					statusLabel !== "Active" &&
					!statusLabel.startsWith("Unknown") &&
					!statusLabel.startsWith("Not Set")
				) {
					let badgeClass = "status-badge-unknown";

					if (isResolved) {
						badgeClass = "status-badge-resolved";
					} else if (statusNum === 3 || statusNum === 5) {
						badgeClass = "status-badge-wontfix";
					} else if (statusNum === 6) {
						badgeClass = "status-badge-pending";
					}

					statusBadge = `<span class="comment-status-badge ${badgeClass}">${this._escapeHtml(statusLabel)}</span>`;
				}

				const timeAgo = formatTimeAgo(thread.lastUpdatedDate);

				// Thread actions (resolve/unresolve)
				const threadActionsHtml = `
					<div class="thread-actions">
						${
							!isResolved
								? `<button class="thread-action-btn resolve-btn" data-thread-id="${thread.id}" title="Resolve thread">Resolve</button>`
								: `<button class="thread-action-btn unresolve-btn" data-thread-id="${thread.id}" title="Reopen thread">Reopen</button>`
						}
					</div>
				`;

				// Comment actions for first comment (edit/delete) - only for own comments
				const firstCommentActionsHtml = canEditFirstComment
					? `
					<div class="comment-actions">
						<button class="edit-comment-btn" data-thread-id="${thread.id}" data-comment-id="${firstComment.id}" title="Edit">Edit</button>
						<button class="delete-comment-btn" data-thread-id="${thread.id}" data-comment-id="${firstComment.id}" title="Delete">Delete</button>
					</div>
				`
					: "";

				// Build replies HTML with edit/delete buttons for own comments
				let repliesHtml = "";
				if (replyCount > 0) {
					const replies = thread.comments
						.slice(1)
						.map((comment) => {
							const replyAuthor = comment.author?.displayName || "[Author name unavailable]";
							const rawReplyContent = comment.content || "[No content]";
							const replyContent = cleanCommentContent(rawReplyContent);
							const replyTime = formatTimeAgo(comment.publishedDate);
							const canEditReply = this.currentUserId && comment.author?.id === this.currentUserId;

							const replyActionsHtml = canEditReply
								? `
								<div class="comment-actions">
									<button class="edit-comment-btn" data-thread-id="${thread.id}" data-comment-id="${comment.id}" title="Edit">Edit</button>
									<button class="delete-comment-btn" data-thread-id="${thread.id}" data-comment-id="${comment.id}" title="Delete">Delete</button>
								</div>
							`
								: "";

							return `
                        <div class="comment-reply" data-comment-id="${comment.id}">
                            <div class="comment-reply-header">
                                <span class="comment-author">${this._escapeHtml(replyAuthor)}</span>
                                <span class="comment-time">${replyTime}</span>
                            </div>
                            <div class="comment-body" data-original-content="${escapeHtml(replyContent)}">${autoLinkUrls(sanitizeHtml(replyContent))}</div>
                            ${replyActionsHtml}
                        </div>`;
						})
						.join("");

					repliesHtml = `<div class="comment-replies">${replies}</div>`;
				}

				// Reply form
				const replyFormHtml = `
					<div class="reply-section">
						<button class="reply-toggle-btn" data-thread-id="${thread.id}">Reply</button>
						<div class="reply-form" id="reply-form-${thread.id}" style="display: none;">
							<textarea class="reply-textarea" id="reply-textarea-${thread.id}" placeholder="Write a reply..." rows="3"></textarea>
							<div class="reply-form-actions">
								<button class="submit-reply-btn" data-thread-id="${thread.id}">Submit</button>
								<button class="cancel-reply-btn" data-thread-id="${thread.id}">Cancel</button>
							</div>
						</div>
					</div>
				`;

				return `
                <div class="general-comment-thread" data-thread-id="${thread.id}">
                    <div class="comment-header">
                        <div class="comment-header-left">
                            <span class="comment-author">${this._escapeHtml(authorName)}</span>
                            <span class="comment-time">${timeAgo}</span>
                        </div>
                        <div class="comment-header-right">
                            ${statusBadge}
                            ${threadActionsHtml}
                        </div>
                    </div>
                    <div class="comment-body" data-comment-id="${firstComment.id}" data-original-content="${escapeHtml(content)}">${autoLinkUrls(sanitizeHtml(content))}</div>
                    ${firstCommentActionsHtml}
                    ${repliesHtml}
                    ${replyFormHtml}
                </div>`;
			})
			.filter((html) => html !== "")
			.join("");

		return `
        <div class="general-comments-section">
            <h3 class="section-title">General Comments (${generalThreads.length})</h3>
            <div class="general-comments-list">
                ${threadItems}
            </div>
        </div>`;
	}

	private _getFileChangesHtml(fileChanges: PRFileChange[], threads: PRThread[]): string {
		if (fileChanges.length === 0) {
			return `
            <div class="file-changes-section">
                <div class="empty-state" style="padding: 40px 20px; text-align: center;">No file changes available</div>
            </div>`;
		}

		// Count comments per file
		const commentCounts = this._countCommentsPerFile(threads);

		const fileItems = fileChanges
			.filter((change) => !change.item.isFolder)
			.map((change, index) => {
				let changeTypeClass = "change-edit";
				let changeTypeText = "M";

				if (change.changeType?.includes("add")) {
					changeTypeClass = "change-add";
					changeTypeText = "A";
				} else if (change.changeType?.includes("delete")) {
					changeTypeClass = "change-delete";
					changeTypeText = "D";
				} else if (change.changeType?.includes("rename")) {
					changeTypeClass = "change-rename";
					changeTypeText = "R";
				}

				// Extract filename and directory path
				const fullPath = change.item?.path || "";
				const pathParts = fullPath.split("/");
				const fileName = pathParts.pop() || fullPath;
				const dirPath = pathParts.join("/") || "/";

				// Handle rename case
				let displayFileName = fileName;
				const displayDirPath = dirPath;

				if (change.changeType?.includes("rename") && change.originalPath) {
					const originalFileName = change.originalPath.split("/").pop() || change.originalPath;
					displayFileName = `${this._escapeHtml(originalFileName)} → ${this._escapeHtml(fileName)}`;
				}

				// Normalize path for lookup - ensure it starts with /
				let normalizedPath = change.item?.path || "";
				if (!normalizedPath.startsWith("/")) {
					normalizedPath = `/${normalizedPath}`;
				}

				// Get comment count for this file
				const commentCount = commentCounts.get(normalizedPath) || 0;
				const commentSuffix = commentCount === 1 ? "" : "s";
				const commentBadge =
					commentCount > 0
						? `<span class="comment-count-badge" title="${commentCount} comment${commentSuffix}">💬 ${commentCount}</span>`
						: "";

				// Check if file is reviewed
				const isReviewed =
					PullRequestViewerPanel._reviewedFilesService?.isFileReviewed(
						this.pullRequest.repository.project.id,
						this.pullRequest.repository.id,
						this.pullRequest.pullRequestId,
						normalizedPath,
					) || false;

				// Always show reviewed badge (filled when reviewed, outline when not)
				const reviewedClass = isReviewed
					? "reviewed-badge reviewed"
					: "reviewed-badge not-reviewed";
				const reviewedTitle = isReviewed
					? "Reviewed - Click to mark as not reviewed"
					: "Not reviewed - Click to mark as reviewed";
				const reviewedBadge = `<span class="${reviewedClass}" data-action="toggle-reviewed" title="${reviewedTitle}">✓</span>`;

				return `
                <li class="file-item" data-file-path="${this._escapeHtml(change.item?.path)}" data-change-type="${this._escapeHtml(change.changeType)}" data-original-path="${this._escapeHtml(change.originalPath || "")}" data-file-index="${index}">
                    <span class="file-change-type ${changeTypeClass}">${changeTypeText}</span>
                    <div class="file-info">
                        <span class="file-name">${this._escapeHtml(displayFileName)}</span>
                        <span class="file-dir-path">${this._escapeHtml(displayDirPath)}</span>
                    </div>
                    ${commentBadge}
                    ${reviewedBadge}
                </li>`;
			})
			.join("");

		return `
        <div class="file-changes-section">
            <ul class="file-list">
                ${fileItems}
            </ul>
        </div>`;
	}

	private _getScripts(nonce: string): string {
		return `
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();

            // Use event delegation to handle file clicks
            document.addEventListener('DOMContentLoaded', function() {
                console.log('PR Viewer scripts loaded');

                // Tab switching logic
                const tabButtons = document.querySelectorAll('.tab-button');
                tabButtons.forEach(button => {
                    button.addEventListener('click', function() {
                        const tabName = this.getAttribute('data-tab');

                        // Remove active class from all buttons and panels
                        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

                        // Add active class to clicked button and corresponding panel
                        this.classList.add('active');
                        const panel = document.querySelector(\`[data-panel="\${tabName}"]\`);
                        if (panel) {
                            panel.classList.add('active');
                        }

                        console.log('Switched to tab:', tabName);
                    });
                });

                // Add click handlers to all file items
                document.addEventListener('click', function(event) {
                    const target = event.target;

                    // Handle reviewed badge clicks (check this first to prevent file opening)
                    const reviewedBadge = target.closest('.reviewed-badge');
                    if (reviewedBadge) {
                        event.stopPropagation();  // Don't trigger file open

                        const fileItem = reviewedBadge.closest('.file-item');
                        const filePath = fileItem.getAttribute('data-file-path');
                        console.log('Reviewed badge clicked:', filePath);

                        try {
                            vscode.postMessage({
                                command: 'toggleFileReviewed',
                                filePath: filePath
                            });
                        } catch (error) {
                            console.error('Error toggling reviewed state:', error);
                        }
                        return;  // Don't fall through to file opening
                    }

                    // Find the closest file-item element
                    const fileItem = target.closest('.file-item');

                    if (fileItem) {
                        const filePath = fileItem.getAttribute('data-file-path');
                        const changeType = fileItem.getAttribute('data-change-type');
                        const originalPath = fileItem.getAttribute('data-original-path');
                        console.log('File clicked:', filePath, 'changeType:', changeType, 'originalPath:', originalPath);

                        try {
                            vscode.postMessage({
                                command: 'openFile',
                                path: filePath,
                                changeType: changeType,
                                originalPath: originalPath
                            });
                            console.log('Message posted successfully');
                        } catch (error) {
                            console.error('Error posting message:', error);
                        }
                    }

                    // Handle open in browser button clicks
                    const openBrowserBtn = target.closest('.open-browser-btn');
                    if (openBrowserBtn) {
                        const url = openBrowserBtn.getAttribute('data-url');
                        console.log('Opening in browser:', url);

                        try {
                            vscode.postMessage({
                                command: 'openExternal',
                                url: url
                            });
                        } catch (error) {
                            console.error('Error opening browser:', error);
                        }
                    }

                    // Handle review action button clicks
                    const reviewActionBtn = target.closest('.review-action-btn');
                    if (reviewActionBtn) {
                        const vote = parseInt(reviewActionBtn.getAttribute('data-vote'), 10);
                        const action = reviewActionBtn.getAttribute('data-action');
                        console.log('Review action clicked:', action, 'vote:', vote);

                        try {
                            vscode.postMessage({
                                command: 'submitReview',
                                vote: vote
                            });
                            console.log('Review submission message posted successfully');
                        } catch (error) {
                            console.error('Error posting review message:', error);
                        }
                    }

                    // Handle refresh button clicks
                    const refreshBtn = target.closest('.refresh-btn');
                    if (refreshBtn) {
                        console.log('Refresh button clicked');

                        try {
                            vscode.postMessage({
                                command: 'refresh'
                            });
                            console.log('Refresh message posted successfully');
                        } catch (error) {
                            console.error('Error posting refresh message:', error);
                        }
                    }

                    // Handle reply toggle button clicks
                    const replyToggleBtn = target.closest('.reply-toggle-btn');
                    if (replyToggleBtn) {
                        const threadId = replyToggleBtn.getAttribute('data-thread-id');
                        const form = document.getElementById('reply-form-' + threadId);
                        if (form) {
                            form.style.display = form.style.display === 'none' ? 'block' : 'none';
                        }
                    }

                    // Handle submit reply button clicks
                    const submitReplyBtn = target.closest('.submit-reply-btn');
                    if (submitReplyBtn) {
                        const threadId = parseInt(submitReplyBtn.getAttribute('data-thread-id'), 10);
                        const textarea = document.getElementById('reply-textarea-' + threadId);
                        const content = textarea ? textarea.value.trim() : '';
                        if (content) {
                            vscode.postMessage({ command: 'replyToThread', threadId: threadId, content: content });
                            textarea.value = '';
                            const form = document.getElementById('reply-form-' + threadId);
                            if (form) form.style.display = 'none';
                        }
                    }

                    // Handle cancel reply button clicks
                    const cancelReplyBtn = target.closest('.cancel-reply-btn');
                    if (cancelReplyBtn) {
                        const threadId = cancelReplyBtn.getAttribute('data-thread-id');
                        const form = document.getElementById('reply-form-' + threadId);
                        if (form) form.style.display = 'none';
                        const textarea = document.getElementById('reply-textarea-' + threadId);
                        if (textarea) textarea.value = '';
                    }

                    // Handle resolve thread button clicks
                    const resolveBtn = target.closest('.resolve-btn');
                    if (resolveBtn) {
                        const threadId = parseInt(resolveBtn.getAttribute('data-thread-id'), 10);
                        vscode.postMessage({ command: 'resolveThread', threadId: threadId });
                    }

                    // Handle unresolve thread button clicks
                    const unresolveBtn = target.closest('.unresolve-btn');
                    if (unresolveBtn) {
                        const threadId = parseInt(unresolveBtn.getAttribute('data-thread-id'), 10);
                        vscode.postMessage({ command: 'unresolveThread', threadId: threadId });
                    }

                    // Handle delete comment button clicks
                    const deleteCommentBtn = target.closest('.delete-comment-btn');
                    if (deleteCommentBtn) {
                        if (confirm('Are you sure you want to delete this comment?')) {
                            const threadId = parseInt(deleteCommentBtn.getAttribute('data-thread-id'), 10);
                            const commentId = parseInt(deleteCommentBtn.getAttribute('data-comment-id'), 10);
                            vscode.postMessage({ command: 'deleteComment', threadId: threadId, commentId: commentId });
                        }
                    }

                    // Handle edit comment button clicks
                    const editCommentBtn = target.closest('.edit-comment-btn');
                    if (editCommentBtn) {
                        const threadId = parseInt(editCommentBtn.getAttribute('data-thread-id'), 10);
                        const commentId = parseInt(editCommentBtn.getAttribute('data-comment-id'), 10);
                        const commentThread = editCommentBtn.closest('.general-comment-thread, .comment-reply');
                        const commentBody = commentThread ? commentThread.querySelector('.comment-body') : null;
                        const currentContent = commentBody ? (commentBody.getAttribute('data-original-content') || commentBody.textContent) : '';
                        const newContent = prompt('Edit your comment:', currentContent);
                        if (newContent !== null && newContent.trim() !== '') {
                            vscode.postMessage({ command: 'editComment', threadId: threadId, commentId: commentId, content: newContent });
                        }
                    }
                });

                // Listen for messages from extension (e.g., reviewed state changes, success/error notifications)
                window.addEventListener('message', event => {
                    const message = event.data;

                    if (message.command === 'fileReviewedStateChanged') {
                        const fileItem = document.querySelector(
                            \`[data-file-path="\${message.filePath}"]\`
                        );

                        if (fileItem) {
                            const badge = fileItem.querySelector('.reviewed-badge');

                            if (badge) {
                                // Toggle classes and update tooltip
                                if (message.reviewed) {
                                    badge.classList.remove('not-reviewed');
                                    badge.classList.add('reviewed');
                                    badge.setAttribute('title', 'Reviewed - Click to mark as not reviewed');
                                } else {
                                    badge.classList.remove('reviewed');
                                    badge.classList.add('not-reviewed');
                                    badge.setAttribute('title', 'Not reviewed - Click to mark as reviewed');
                                }
                                console.log('Updated reviewed state for:', message.filePath, 'reviewed:', message.reviewed);
                            }
                        }
                    }

                    // Handle success/error messages from comment operations
                    if (message.type === 'success') {
                        console.log('Success:', message.message);
                    }
                    if (message.type === 'error') {
                        console.error('Error:', message.message);
                        alert(message.message);
                    }
                });
            });
        </script>`;
	}

	private _escapeHtml(text: string | null | undefined): string {
		if (text == null) {
			return "";
		}
		const map: { [key: string]: string } = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#039;",
		};
		return text.replaceAll(/[&<>"']/g, (m) => map[m]);
	}

	/**
	 * Convert technical error messages to user-friendly messages
	 */
	private _getFriendlyErrorMessage(error: unknown): string {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const lowerError = errorMessage.toLowerCase();

		// Network and connection errors
		if (lowerError.includes("fetch") && lowerError.includes("failed")) {
			return "Unable to connect to Azure DevOps. Please check your network connection.";
		}
		if (lowerError.includes("timeout") || lowerError.includes("timed out")) {
			return "The request took too long to complete. Please try again.";
		}
		if (lowerError.includes("network") || lowerError.includes("econnrefused")) {
			return "Network error. Please check your connection and try again.";
		}

		// Authentication errors
		if (lowerError.includes("401") || lowerError.includes("unauthorized")) {
			return "Authentication failed. Please sign in to Azure DevOps and try again.";
		}
		if (lowerError.includes("403") || lowerError.includes("forbidden")) {
			return "You don't have permission to access this pull request.";
		}

		// Not found errors
		if (lowerError.includes("404") || lowerError.includes("not found")) {
			return "Pull request not found. It may have been deleted or you may not have access.";
		}

		// Missing data errors
		if (
			lowerError.includes("missing required") ||
			(lowerError.includes("repository") && lowerError.includes("project"))
		) {
			return "Unable to load pull request details. Some required information is missing.";
		}

		// Configuration errors
		if (lowerError.includes("organization") || lowerError.includes("configuration")) {
			return "Azure DevOps is not configured correctly. Please check your settings.";
		}

		// Rate limiting
		if (lowerError.includes("429") || lowerError.includes("rate limit")) {
			return "Too many requests. Please wait a moment and try again.";
		}

		// Server errors
		if (lowerError.includes("500") || lowerError.includes("502") || lowerError.includes("503")) {
			return "Azure DevOps is experiencing issues. Please try again later.";
		}

		// Generic fallback
		return "Unable to complete the request. Please try again.";
	}
}

function getNonce() {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
