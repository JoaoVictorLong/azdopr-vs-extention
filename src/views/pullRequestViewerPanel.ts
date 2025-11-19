import * as vscode from "vscode";
import type {
	AzureDevOpsClient,
	PullRequest,
	PRFileChange,
} from "../services/azureDevOpsClient";
import {
	PRContextManager,
	type PRFileContext,
} from "../services/prContextManager";

export class PullRequestViewerPanel {
	private static _currentPanel: PullRequestViewerPanel | undefined;
	private static _contentProviderRegistered: boolean = false;
	private static readonly _virtualFileCache: Map<string, string> = new Map();

	public static get currentPanel(): PullRequestViewerPanel | undefined {
		return PullRequestViewerPanel._currentPanel;
	}

	private readonly _panel: vscode.WebviewPanel;
	private readonly _disposables: vscode.Disposable[] = [];

	private constructor(
		panel: vscode.WebviewPanel,
		private readonly azureDevOpsClient: AzureDevOpsClient,
		private pullRequest: PullRequest,
	) {
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
				console.log("Received message from webview:", message);
				switch (message.command) {
					case "openFile":
						console.log(
							"Opening file from webview:",
							message.path,
							"changeType:",
							message.changeType,
							"originalPath:",
							message.originalPath,
						);
						await this._openFileDiff(message.path, message.changeType, message.originalPath);
						break;
					case "openExternal":
						vscode.env.openExternal(vscode.Uri.parse(message.url));
						break;
					case "submitReview":
						await this._handleReviewSubmission(message.vote);
						break;
					default:
						console.log("Unknown command:", message.command);
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
	) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it
		if (PullRequestViewerPanel.currentPanel) {
			PullRequestViewerPanel.currentPanel._panel.reveal(column);
			// Update with new PR data
			PullRequestViewerPanel.currentPanel.pullRequest = pullRequest;
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
		);
		PullRequestViewerPanel._currentPanel = instance;

		// Initialize the panel content asynchronously
		await instance._update();
	}

	public dispose() {
		PullRequestViewerPanel._currentPanel = undefined;

		this._panel.dispose();

		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	private async _update() {
		const webview = this._panel.webview;
		this._panel.title = `PR #${this.pullRequest.pullRequestId}: ${this.pullRequest.title}`;

		try {
			// Validate required PR properties
			if (!this.pullRequest.repository?.project) {
				throw new Error(
					"Pull request is missing required repository or project information",
				);
			}

			webview.html = this._getLoadingHtml();

			// Fetch iterations
			const iterations = await this.azureDevOpsClient.getPullRequestIterations(
				this.pullRequest.repository.project.id,
				this.pullRequest.repository.id,
				this.pullRequest.pullRequestId,
			);

			// Get file changes from the latest iteration
			let fileChanges: PRFileChange[] = [];
			if (iterations.length > 0) {
				const latestIteration = iterations.at(-1);
				if (latestIteration) {
					fileChanges =
						await this.azureDevOpsClient.getPullRequestIterationChanges(
							this.pullRequest.repository.project.id,
							this.pullRequest.repository.id,
							this.pullRequest.pullRequestId,
							latestIteration.id,
						);
				}
			}

			// Convert markdown description to HTML
			const { marked } = await import("marked");
			const descriptionHtml = this.pullRequest.description
				? await marked(this.pullRequest.description)
				: "No description provided.";

			webview.html = this._getHtmlForWebview(webview, fileChanges, descriptionHtml);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			webview.html = this._getErrorHtml(errorMessage);
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
		descriptionHtml: string,
	): string {
		const pr = this.pullRequest;
		const nonce = getNonce();

		// Format dates
		const createdDate = pr.creationDate.toLocaleDateString();
		const createdTime = pr.creationDate.toLocaleTimeString();

		// Format branch names
		const sourceBranch = pr.sourceRefName
			? pr.sourceRefName.replace("refs/heads/", "")
			: "unknown";
		const targetBranch = pr.targetRefName
			? pr.targetRefName.replace("refs/heads/", "")
			: "unknown";

		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>PR #${pr.pullRequestId}</title>
            ${this._getStyles()}
        </head>
        <body>
            <div class="container">
                ${this._getHeaderHtml(pr, sourceBranch, targetBranch, createdDate, createdTime)}
                <div class="review-section-wrapper">
                    ${this._getCombinedReviewsHtml(pr)}
                    ${this._getDescriptionHtml(descriptionHtml)}
                </div>
                ${this._getFileChangesHtml(fileChanges)}
            </div>
            ${this._getScripts(nonce)}
        </body>
        </html>`;
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

			// Refresh the panel to show updated reviewer status
			await this._update();
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			vscode.window.showErrorMessage(
				`Failed to submit review: ${errorMessage}`,
			);
			console.error("Error submitting review:", error);
		}
	}

	/**
	 * Open a file in diff view showing changes between base and modified versions
	 */
	private async _openFileDiff(path: string, changeType: string, originalPath?: string) {
		try {
			console.log("Opening file diff:", path, "changeType:", changeType, "originalPath:", originalPath);
			vscode.window.setStatusBarMessage(`Loading diff for ${path}...`, 3000);

			const isAdded = changeType.includes("add");
			const isDeleted = changeType.includes("delete");
			const isRenamed = changeType.includes("rename");

			// Get branch names
			const sourceBranch = this.pullRequest.sourceRefName
				? this.pullRequest.sourceRefName.replace("refs/heads/", "")
				: "unknown";
			const targetBranch = this.pullRequest.targetRefName
				? this.pullRequest.targetRefName.replace("refs/heads/", "")
				: "unknown";

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
						// Fetch base version (from target branch) unless file is added
						if (!isAdded) {
							progress.report({
								increment: 25,
								message: "Fetching base version...",
							});
							// Use originalPath for renamed files when fetching the base version
							const basePathToFetch = isRenamed && originalPath ? originalPath : path;
							baseContent = await this.azureDevOpsClient.getFileContent(
								this.pullRequest.repository.project.id,
								this.pullRequest.repository.id,
								basePathToFetch,
								targetBranch,
							);
						}

						// Fetch modified version (from source branch) unless file is deleted
						if (!isDeleted) {
							progress.report({
								increment: 50,
								message: "Fetching modified version...",
							});
							modifiedContent = await this.azureDevOpsClient.getFileContent(
								this.pullRequest.repository.project.id,
								this.pullRequest.repository.id,
								path,
								sourceBranch,
							);
						}

						progress.report({ increment: 75, message: "Opening diff view..." });

						// Create virtual document URIs for both versions
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
									return (
										PullRequestViewerPanel._virtualFileCache.get(
											uri.toString(),
										) || ""
									);
								},
							});
						}

						// Cache the content for both versions
						PullRequestViewerPanel._virtualFileCache.set(
							baseUri.toString(),
							baseContent,
						);
						PullRequestViewerPanel._virtualFileCache.set(
							modifiedUri.toString(),
							modifiedContent,
						);

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
						console.log(`[PRViewerPanel] Set base context for: ${baseUri.toString()}`);

						// Modified (right) side context
						const modifiedContext: PRFileContext = {
							pullRequest: this.pullRequest,
							filePath: path,
							side: "modified",
							changeType: changeType,
						};
						contextManager.setPRFileContext(modifiedUri, modifiedContext);
						console.log(`[PRViewerPanel] Set modified context for: ${modifiedUri.toString()}`);

						// Legacy support
						contextManager.setFileContext(
							modifiedUri.toString(),
							this.pullRequest,
						);

						// Open diff view
						await vscode.commands.executeCommand(
							"vscode.diff",
							baseUri,
							modifiedUri,
							title,
						);

						progress.report({ increment: 100 });
						console.log("Diff view opened successfully for:", path);
					} catch (error) {
						const errorMessage =
							error instanceof Error ? error.message : "Unknown error";
						console.error("Error fetching file content:", error);

						// Offer to view in browser as fallback
						const action = await vscode.window.showErrorMessage(
							`Failed to fetch file content: ${errorMessage}`,
							"View in Browser",
						);

						if (action === "View in Browser") {
							const org = vscode.workspace
								.getConfiguration("azureDevOpsPRViewer")
								.get<string>("organization", "");
							const projectName =
								this.pullRequest.repository?.project?.name || "unknown";
							const repoName = this.pullRequest.repository?.name || "unknown";
							const webUrl = `https://dev.azure.com/${org}/${projectName}/_git/${repoName}/pullrequest/${this.pullRequest.pullRequestId}?_a=files&path=${encodeURIComponent(path)}`;
							vscode.env.openExternal(vscode.Uri.parse(webUrl));
						}
					}
				},
			);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			console.error("Error opening file diff:", error);
			vscode.window.showErrorMessage(`Failed to open diff: ${errorMessage}`);
		}
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
                border-bottom: 1px solid var(--vscode-panel-border);
                padding-bottom: 20px;
                margin-bottom: 20px;
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
            .open-browser-btn {
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
            .open-browser-btn:hover {
                background-color: var(--vscode-list-hoverBackground);
                border-color: var(--vscode-textLink-foreground);
            }
            .open-browser-btn:active {
                background-color: var(--vscode-list-activeSelectionBackground);
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
                overflow-x: auto;
                word-wrap: break-word;
            }
            .description h1, .description h2, .description h3, .description h4, .description h5, .description h6 {
                margin-top: 15px;
                margin-bottom: 10px;
                font-weight: 600;
            }
            .description h1 { font-size: 20px; }
            .description h2 { font-size: 18px; }
            .description h3 { font-size: 16px; }
            .description h4 { font-size: 14px; }
            .description h5 { font-size: 13px; }
            .description h6 { font-size: 12px; }
            .description p {
                margin: 10px 0;
            }
            .description ul, .description ol {
                margin: 10px 0;
                padding-left: 25px;
            }
            .description li {
                margin: 5px 0;
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
                margin: 10px 0;
            }
            .description pre code {
                background-color: transparent;
                padding: 0;
            }
            .description blockquote {
                border-left: 3px solid var(--vscode-panel-border);
                padding-left: 10px;
                margin: 10px 0;
                color: var(--vscode-descriptionForeground);
            }
            .description a {
                color: var(--vscode-textLink-foreground);
                text-decoration: none;
            }
            .description a:hover {
                text-decoration: underline;
            }
            .description table {
                border-collapse: collapse;
                margin: 10px 0;
                width: 100%;
            }
            .description th, .description td {
                border: 1px solid var(--vscode-panel-border);
                padding: 6px 10px;
                text-align: left;
            }
            .description th {
                background-color: var(--vscode-editor-background);
                font-weight: 600;
            }
            .description hr {
                border: none;
                border-top: 1px solid var(--vscode-panel-border);
                margin: 15px 0;
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
                border-bottom: 1px solid var(--vscode-panel-border);
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
        </style>`;
	}

	private _getHeaderHtml(
		pr: PullRequest,
		sourceBranch: string,
		targetBranch: string,
		createdDate: string,
		createdTime: string,
	): string {
		const statusClass = pr.isDraft ? "status-draft" : "status-active";
		const statusText = pr.isDraft ? "Draft" : pr.status;

		// Build the PR URL
		const org = vscode.workspace
			.getConfiguration("azureDevOpsPRViewer")
			.get<string>("organization", "");
		const prUrl = `https://dev.azure.com/${org}/${pr.repository?.project?.name || "unknown"}/_git/${pr.repository?.name || "unknown"}/pullrequest/${pr.pullRequestId}`;

		return `
        <div class="header">
            <div class="header-top">
                <h1 class="pr-title">
                    ${this._escapeHtml(pr.title || "Untitled PR")}
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </h1>
                <button class="open-browser-btn" data-url="${this._escapeHtml(prUrl)}" title="Open PR in Azure DevOps">
                    Open in Browser
                </button>
            </div>
            <div class="pr-meta">
                #${pr.pullRequestId} opened on ${createdDate} at ${createdTime} by ${this._escapeHtml(pr.createdBy?.displayName || "Unknown")}
            </div>
            <div class="pr-meta-secondary">
                <span class="meta-item">
                    <span class="meta-label">Repository:</span> ${this._escapeHtml(pr.repository?.name) || "Unknown"}
                </span>
                <span class="meta-separator">•</span>
                <span class="meta-item">
                    <span class="meta-label">Project:</span> ${this._escapeHtml(pr.repository?.project?.name) || "Unknown"}
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
		let reviewerItems = '<div class="empty-state" style="padding: 15px; text-align: center;">No reviewers assigned</div>';

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
							<span class="reviewer-name">${this._escapeHtml(reviewer.displayName || reviewer.uniqueName || "Unknown")}</span>
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

	private _getReviewActionsHtml(pr: PullRequest): string {
		return `
        <div class="review-actions-section">
            <h3 class="section-title" style="margin-bottom: 8px; font-size: 14px;">Your Review</h3>
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
        </div>`;
	}

	private _getReviewersHtml(pr: PullRequest): string {
		if (!pr.reviewers || pr.reviewers.length === 0) {
			return `
            <div class="reviewers-section">
                <h3 class="section-title" style="margin-bottom: 8px; font-size: 14px;">Reviewers</h3>
                <div class="empty-state">No reviewers assigned</div>
            </div>`;
		}

		// Calculate vote counts
		const approvedCount = pr.reviewers.filter((r) => r.vote === 10).length;
		const approvedWithSuggestionsCount = pr.reviewers.filter((r) => r.vote === 5).length;
		const rejectedCount = pr.reviewers.filter((r) => r.vote === -10).length;
		const waitingCount = pr.reviewers.filter((r) => r.vote === 0).length;

		const reviewerItems = pr.reviewers
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
                        <span class="reviewer-name">${this._escapeHtml(reviewer.displayName || reviewer.uniqueName || "Unknown")}</span>
                        ${requiredBadge}
                    </div>
                    <div class="reviewer-vote">
                        <span class="vote-icon ${voteClass}">${voteIcon}</span>
                        <span class="vote-text ${voteClass}">${voteText}</span>
                    </div>
                </div>`;
			})
			.join("");

		return `
        <div class="reviewers-section">
            <div class="reviewers-header">
                <h3 class="section-title" style="font-size: 14px;">Reviewers (${pr.reviewers.length})</h3>
                <div class="reviewer-counts">
                    <span class="count-item vote-approved">✓ ${approvedCount + approvedWithSuggestionsCount}</span>
                    <span class="count-separator">•</span>
                    <span class="count-item vote-rejected">✗ ${rejectedCount}</span>
                    <span class="count-separator">•</span>
                    <span class="count-item vote-waiting">○ ${waitingCount}</span>
                </div>
            </div>
            <div class="reviewer-list-detailed">
                ${reviewerItems}
            </div>
        </div>`;
	}

	private _getDescriptionHtml(descriptionHtml: string): string {
		return `
        <div class="reviewers-section">
            <h3 class="section-title" style="margin-bottom: 8px; font-size: 14px;">Description</h3>
            <div class="description">${descriptionHtml}</div>
        </div>`;
	}

	private _getFileChangesHtml(fileChanges: PRFileChange[]): string {
		if (fileChanges.length === 0) {
			return `
            <div class="section">
                <h2 class="section-title" style="margin-bottom: 15px; padding-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border);">File Changes</h2>
                <div class="empty-state">No file changes available</div>
            </div>`;
		}

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

				// Display path with rename indicator if applicable
				let displayPath = this._escapeHtml(change.item?.path);
				if (change.changeType?.includes("rename") && change.originalPath) {
					const originalFileName = change.originalPath.split("/").pop() || change.originalPath;
					const newFileName = change.item?.path.split("/").pop() || change.item?.path;
					displayPath = `${this._escapeHtml(originalFileName)} → ${this._escapeHtml(newFileName)}`;
				}

				return `
                <li class="file-item" data-file-path="${this._escapeHtml(change.item?.path)}" data-change-type="${this._escapeHtml(change.changeType)}" data-original-path="${this._escapeHtml(change.originalPath || '')}" data-file-index="${index}">
                    <span class="file-change-type ${changeTypeClass}">${changeTypeText}</span>
                    <span>${displayPath}</span>
                </li>`;
			})
			.join("");

		return `
        <div class="section">
            <h2 class="section-title" style="margin-bottom: 15px; padding-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border);">File Changes (${fileChanges.filter((c) => !c.item.isFolder).length})</h2>
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

                // Add click handlers to all file items
                document.addEventListener('click', function(event) {
                    const target = event.target;

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
}

function getNonce() {
	let text = "";
	const possible =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
