import * as vscode from "vscode";
import { AzureDevOpsAuthProvider } from "./auth/authProvider";
import { PullRequestProvider } from "./providers/pullRequestProvider";
import {
	AzureDevOpsClient,
	type PullRequest,
} from "./services/azureDevOpsClient";
import { PullRequestViewerPanel } from "./views/pullRequestViewerPanel";
import { PRContextManager } from "./services/prContextManager";
import { PRCommentCodeLensProvider } from "./providers/prCommentCodeLensProvider";
import { PRCommentDecorationProvider } from "./providers/prCommentDecorationProvider";
import { PRCommentController } from "./providers/prCommentController";

let pullRequestProvider: PullRequestProvider;
let authProvider: AzureDevOpsAuthProvider;
let refreshInterval: NodeJS.Timeout | undefined;
let azureDevOpsClient: AzureDevOpsClient;
let codeLensProvider: PRCommentCodeLensProvider;
let decorationProvider: PRCommentDecorationProvider;
let commentController: PRCommentController;

export async function activate(context: vscode.ExtensionContext) {
	console.log("Azure DevOps PR Viewer extension is now active");

	// Initialize authentication provider
	authProvider = new AzureDevOpsAuthProvider();

	// Set initial authentication context
	const isAuthenticated = await authProvider.isAuthenticated();
	await vscode.commands.executeCommand(
		"setContext",
		"azureDevOpsPRs:authenticated",
		isAuthenticated,
	);

	// Initialize Azure DevOps client
	azureDevOpsClient = new AzureDevOpsClient(authProvider);

	// Initialize the Pull Request tree view provider
	pullRequestProvider = new PullRequestProvider(
		azureDevOpsClient,
		authProvider,
	);

	// Register the tree view
	vscode.window.registerTreeDataProvider("azureDevOpsPRs", pullRequestProvider);

	// Initialize and register the CodeLens provider for PR comments
	codeLensProvider = new PRCommentCodeLensProvider();

	// Initialize the decoration provider for PR comments
	decorationProvider = new PRCommentDecorationProvider();

	// Initialize the comment controller for displaying PR comments inline
	commentController = new PRCommentController(azureDevOpsClient);
	// Initialize asynchronously (don't await to avoid blocking activation)
	commentController.initialize();

	// Collect all subscriptions
	const subscriptions = [
		vscode.commands.registerCommand(
			"azureDevOpsPRs.refreshComments",
			async () => {
				console.log("[Extension] Manual comment refresh requested");
				await commentController.refresh();
			},
		),
		vscode.languages.registerCodeLensProvider(
			{ scheme: "azdo-pr" },
			codeLensProvider,
		),
		decorationProvider,
		commentController,
		vscode.commands.registerCommand("azureDevOpsPRs.refresh", () => {
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand("azureDevOpsPRs.signIn", async () => {
			try {
				await authProvider.signIn();
				await vscode.commands.executeCommand(
					"setContext",
					"azureDevOpsPRs:authenticated",
					true,
				);
				vscode.window.showInformationMessage(
					"Successfully signed in to Azure DevOps PR Viewer",
				);
				pullRequestProvider.refresh();
			} catch (error) {
				vscode.window.showErrorMessage(`Sign in failed: ${error}`);
			}
		}),
		vscode.commands.registerCommand("azureDevOpsPRs.signOut", async () => {
			await authProvider.signOut();
			await vscode.commands.executeCommand(
				"setContext",
				"azureDevOpsPRs:authenticated",
				false,
			);
			vscode.window.showInformationMessage("Signed out from Azure DevOps PR Viewer");
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand(
			"azureDevOpsPRs.openPR",
			async (arg: any) => {
				let url: string | undefined;

				if (typeof arg === "string") {
					// Called with URL string (legacy)
					url = arg;
				}

				if (arg?.pullRequest) {
					// Called from context menu - arg is a tree item
					const pr = arg.pullRequest as PullRequest;
					const org = vscode.workspace
						.getConfiguration("azureDevOpsPRViewer")
						.get<string>("organization", "");
					url = `https://dev.azure.com/${org}/${pr.repository.project.name}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`;
				}

				if (arg?.repository) {
					// Called with PR object directly
					const pr = arg as PullRequest;
					const org = vscode.workspace
						.getConfiguration("azureDevOpsPRViewer")
						.get<string>("organization", "");
					url = `https://dev.azure.com/${org}/${pr.repository.project.name}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`;
				}

				if (!url) {
					vscode.window.showErrorMessage("Unable to open PR: invalid argument");
					return;
				}

				await vscode.env.openExternal(vscode.Uri.parse(url));
			},
		),
		vscode.commands.registerCommand(
			"azureDevOpsPRs.viewPR",
			async (arg: any) => {
				let pr: PullRequest | undefined;

				if (arg?.pullRequest) {
					// Called from context menu or tree item click - arg is a tree item
					pr = arg.pullRequest as PullRequest;
				}

				if (arg?.repository) {
					// Called with PR object directly
					pr = arg as PullRequest;
				}

				if (!pr) {
					vscode.window.showErrorMessage("Unable to view PR: invalid argument");
					return;
				}

				await PullRequestViewerPanel.createOrShow(
					context.extensionUri,
					azureDevOpsClient,
					pr,
				);
			},
		),
		vscode.commands.registerCommand(
			"azureDevOpsPRs.addLineComment",
			async () => {
				try {
					// Get the active editor
					const editor = vscode.window.activeTextEditor;
					if (!editor) {
						vscode.window.showWarningMessage(
							"No active editor. Please open a file first.",
						);
						return;
					}

					// Get the current line number (1-based)
					const lineNumber = editor.selection.active.line + 1;

					// Get the PR file context
					const contextManager = PRContextManager.getInstance();
					const fileContext = contextManager.getPRFileContext(
						editor.document.uri,
					);

					if (!fileContext) {
						vscode.window.showWarningMessage(
							"No pull request context found. Please open a file from the PR viewer first.",
						);
						return;
					}

					const pr = fileContext.pullRequest;
					const filePath = fileContext.filePath;
					const side = fileContext.side;

					// Prompt for comment text
					const commentText = await vscode.window.showInputBox({
						prompt: `Add comment to line ${lineNumber} in ${pr.title}`,
						placeHolder: "Enter your comment...",
						validateInput: (value) => {
							if (!value || value.trim().length === 0) {
								return "Comment cannot be empty";
							}
							return null;
						},
					});

					if (!commentText) {
						return; // User cancelled
					}

					// Show progress
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: "Adding PR comment...",
							cancellable: false,
						},
						async (progress) => {
							progress.report({ increment: 0 });

							// Create the PR thread with the comment
							await azureDevOpsClient.createPRThread(
								pr.repository.project.id,
								pr.repository.id,
								pr.pullRequestId,
								filePath,
								lineNumber,
								commentText,
								side,
							);

							progress.report({ increment: 100 });
						},
					);

					// Show success message
					const sideText = side === "base" ? "original" : "modified";
					vscode.window.showInformationMessage(
						`Comment added to PR #${pr.pullRequestId} at line ${lineNumber} (${sideText} version)`,
					);

					// Refresh the comment controller to show the new comment inline
					await commentController.refresh();
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : "Unknown error";
					vscode.window.showErrorMessage(
						`Failed to add comment: ${errorMessage}`,
					);
					console.error("Error adding PR comment:", error);
				}
			},
		),
		vscode.commands.registerCommand(
			"azureDevOpsPRs.addLineCommentFromCodeLens",
			async (uri: vscode.Uri, lineNumber: number) => {
				try {
					// Get the PR file context
					const contextManager = PRContextManager.getInstance();
					const fileContext = contextManager.getPRFileContext(uri);

					if (!fileContext) {
						vscode.window.showWarningMessage(
							"No pull request context found for this file.",
						);
						return;
					}

					const pr = fileContext.pullRequest;
					const filePath = fileContext.filePath;
					const side = fileContext.side;

					// Prompt for comment text
					const commentText = await vscode.window.showInputBox({
						prompt: `Add comment to line ${lineNumber} in ${pr.title}`,
						placeHolder: "Enter your comment...",
						validateInput: (value) => {
							if (!value || value.trim().length === 0) {
								return "Comment cannot be empty";
							}
							return null;
						},
					});

					if (!commentText) {
						return; // User cancelled
					}

					// Show progress
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: "Adding PR comment...",
							cancellable: false,
						},
						async (progress) => {
							progress.report({ increment: 0 });

							// Create the PR thread with the comment
							await azureDevOpsClient.createPRThread(
								pr.repository.project.id,
								pr.repository.id,
								pr.pullRequestId,
								filePath,
								lineNumber,
								commentText,
								side,
							);

							progress.report({ increment: 100 });
						},
					);

					// Show success message
					const sideText = side === "base" ? "original" : "modified";
					vscode.window.showInformationMessage(
						`Comment added to PR #${pr.pullRequestId} at line ${lineNumber} (${sideText} version)`,
					);

					// Refresh the comment controller to show the new comment inline
					await commentController.refresh();
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : "Unknown error";
					vscode.window.showErrorMessage(
						`Failed to add comment: ${errorMessage}`,
					);
					console.error("Error adding PR comment from CodeLens:", error);
				}
			},
		),
		// Watch for configuration changes
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("azureDevOpsPRViewer.autoRefreshInterval")) {
				setupAutoRefresh();
			}
		}),
		// Watch for authentication changes to refresh the view
		vscode.authentication.onDidChangeSessions(async (e) => {
			if (e.provider.id === "microsoft") {
				const isAuthenticated = await authProvider.isAuthenticated();
				await vscode.commands.executeCommand(
					"setContext",
					"azureDevOpsPRs:authenticated",
					isAuthenticated,
				);
				pullRequestProvider.refresh();
			}
		}),
	];

	// Push all subscriptions at once
	context.subscriptions.push(...subscriptions);

	// Setup auto-refresh
	setupAutoRefresh();

	// Initialize the tree provider after authentication context is set
	pullRequestProvider.initialize();
}

function setupAutoRefresh() {
	if (refreshInterval) {
		clearInterval(refreshInterval);
		refreshInterval = undefined;
	}

	const config = vscode.workspace.getConfiguration("azureDevOpsPRViewer");
	const interval = config.get<number>("autoRefreshInterval", 0);

	if (interval > 0) {
		refreshInterval = setInterval(() => {
			pullRequestProvider.refresh();
		}, interval * 1000);
	}
}

export function deactivate() {
	if (refreshInterval) {
		clearInterval(refreshInterval);
	}
}
