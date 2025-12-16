import * as vscode from "vscode";
import { AzureDevOpsAuthProvider } from "./auth/authProvider";
import { PRCommentController } from "./providers/prCommentController";
import { PullRequestProvider } from "./providers/pullRequestProvider";
import { AzureDevOpsClient, type PullRequest } from "./services/azureDevOpsClient";
import { CommentEventCoordinator } from "./services/commentEventCoordinator";
import { LfsCache } from "./services/lfs/lfsCache";
import { Logger } from "./utils/logger";
import { PullRequestViewerPanel } from "./views/pullRequestViewerPanel";

const logger = Logger.getInstance();

let pullRequestProvider: PullRequestProvider;
let authProvider: AzureDevOpsAuthProvider;
let refreshInterval: NodeJS.Timeout | undefined;
let azureDevOpsClient: AzureDevOpsClient;
let commentController: PRCommentController;
let commentEventCoordinator: CommentEventCoordinator;

export async function activate(context: vscode.ExtensionContext) {
	logger.info("Azure DevOps PR Viewer extension is now active");

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
	pullRequestProvider = new PullRequestProvider(azureDevOpsClient, authProvider);

	// Register the tree view
	vscode.window.registerTreeDataProvider("azureDevOpsPRs", pullRequestProvider);

	// ========================================================================
	// CRITICAL: Initialize the comment controller for displaying PR comments inline
	// This controller manages VS Code's native Comment API to show Azure DevOps
	// PR comments directly in diff views. Without proper initialization and event
	// handling, comments will NOT appear when users open PR file diffs.
	// DO NOT REMOVE OR MODIFY without understanding the full comment flow.
	// ========================================================================
	commentController = new PRCommentController(azureDevOpsClient);
	// Initialize asynchronously (don't await to avoid blocking activation)
	commentController.initialize();

	// Initialize event coordinator for debounced comment loading
	commentEventCoordinator = new CommentEventCoordinator(commentController);

	// Collect all subscriptions
	const subscriptions = [
		vscode.commands.registerCommand("azureDevOpsPRs.refreshComments", async () => {
			logger.info("Manual comment refresh requested");
			await commentController.refresh();
		}),
		commentController,
		vscode.commands.registerCommand("azureDevOpsPRs.refresh", () => {
			azureDevOpsClient.clearCache();
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand("azureDevOpsPRs.signIn", async () => {
			try {
				await authProvider.signIn();
				await vscode.commands.executeCommand("setContext", "azureDevOpsPRs:authenticated", true);
				vscode.window.showInformationMessage("Successfully signed in to Azure DevOps PR Viewer");
				pullRequestProvider.refresh();
			} catch (error) {
				vscode.window.showErrorMessage(`Sign in failed: ${error}`);
			}
		}),
		vscode.commands.registerCommand("azureDevOpsPRs.signOut", async () => {
			await authProvider.signOut();
			await vscode.commands.executeCommand("setContext", "azureDevOpsPRs:authenticated", false);
			vscode.window.showInformationMessage("Signed out from Azure DevOps PR Viewer");
			pullRequestProvider.refresh();
		}),
		vscode.commands.registerCommand(
			"azureDevOpsPRs.openPR",
			async (arg: string | { pullRequest: PullRequest } | PullRequest | undefined) => {
				let url: string | undefined;

				if (typeof arg === "string") {
					// Called with URL string (legacy)
					url = arg;
				}

				if (arg && typeof arg === "object" && "pullRequest" in arg) {
					// Called from context menu - arg is a tree item
					const pr = arg.pullRequest;
					const org = vscode.workspace
						.getConfiguration("azureDevOpsPRViewer")
						.get<string>("organization", "");
					url = `https://dev.azure.com/${org}/${pr.repository.project.name}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`;
				}

				if (arg && typeof arg === "object" && "repository" in arg) {
					// Called with PR object directly
					const pr = arg;
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
			async (arg: { pullRequest: PullRequest } | PullRequest | undefined) => {
				let pr: PullRequest | undefined;

				if (arg && typeof arg === "object" && "pullRequest" in arg) {
					// Called from context menu or tree item click - arg is a tree item
					pr = arg.pullRequest;
				}

				if (arg && typeof arg === "object" && "repository" in arg) {
					// Called with PR object directly
					pr = arg;
				}

				if (!pr) {
					vscode.window.showErrorMessage("Unable to view PR: invalid argument");
					return;
				}

				await PullRequestViewerPanel.createOrShow(context.extensionUri, azureDevOpsClient, pr);
			},
		),
		vscode.commands.registerCommand("azureDevOpsPRs.clearLfsCache", async () => {
			try {
				const lfsCache = new LfsCache(context);
				const stats = lfsCache.getStats();

				if (stats.fileCount === 0) {
					vscode.window.showInformationMessage("LFS cache is already empty");
					return;
				}

				const action = await vscode.window.showWarningMessage(
					`Clear LFS cache? This will remove ${stats.fileCount} cached file(s) (${stats.totalSizeMB.toFixed(2)} MB)`,
					"Clear Cache",
					"Cancel",
				);

				if (action === "Clear Cache") {
					lfsCache.clear();
					vscode.window.showInformationMessage("LFS cache cleared successfully");
				}
			} catch (error) {
				logger.error("Failed to clear LFS cache", error);
				vscode.window.showErrorMessage(
					`Failed to clear LFS cache: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),
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

		// ========================================================================
		// CRITICAL: Event coordinator for inline comment display in PR diffs
		// This replaces the old dual event listeners with a coordinated, debounced
		// approach that prevents duplicate loads and flickering.
		//
		// How it works:
		// 1. User clicks a file in the PR viewer's "Files Changed" tab
		// 2. PullRequestViewerPanel creates virtual documents with "azdo-pr" scheme
		// 3. CommentEventCoordinator debounces and coordinates comment loading
		// 4. PRCommentController syncs threads differentially (no dispose/recreate)
		//
		// DO NOT REMOVE these listeners - comments will NOT appear without them!
		// ========================================================================

		// Listen for when text documents are opened (catches initial file opens)
		vscode.workspace.onDidOpenTextDocument(
			commentEventCoordinator.handleDocumentEvent.bind(commentEventCoordinator),
		),

		// Listen for when the active editor changes (catches tab switches)
		vscode.window.onDidChangeActiveTextEditor(
			commentEventCoordinator.handleEditorChange.bind(commentEventCoordinator),
		),

		// Listen for when documents are closed (cleanup resources)
		vscode.workspace.onDidCloseTextDocument(
			commentEventCoordinator.handleDocumentClose.bind(commentEventCoordinator),
		),

		// Register the event coordinator for disposal
		commentEventCoordinator,
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
