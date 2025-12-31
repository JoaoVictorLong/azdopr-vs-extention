import * as vscode from "vscode";
import { AzureDevOpsAuthProvider } from "./auth/authProvider";
import { CheckoutBranchCommandHandler } from "./commands/checkoutBranchCommand";
import { PRCommentController } from "./providers/prCommentController";
import { PullRequestProvider } from "./providers/pullRequestProvider";
import { AzureDevOpsClient, type PullRequest } from "./services/azureDevOpsClient";
import { CommentEventCoordinator } from "./services/commentEventCoordinator";
import { GitService } from "./services/gitService";
import { LfsCache } from "./services/lfs/lfsCache";
import { RepositoryMatchingService } from "./services/repositoryMatchingService";
import { ReviewedFilesService } from "./services/reviewedFilesService";
import { Logger } from "./utils/logger";
import { PullRequestViewerPanel } from "./views/pullRequestViewerPanel";

const logger = Logger.getInstance();

let pullRequestProvider: PullRequestProvider;
let authProvider: AzureDevOpsAuthProvider;
let refreshInterval: NodeJS.Timeout | undefined;
let azureDevOpsClient: AzureDevOpsClient;
let commentController: PRCommentController;
let commentEventCoordinator: CommentEventCoordinator;

/**
 * Helper: Extract PullRequest from various command argument formats
 *
 * Commands can be invoked with different argument types:
 * - Tree item click: { pullRequest: PullRequest }
 * - Direct PR object: PullRequest
 * - Legacy URL string: string
 *
 * @param arg - The command argument
 * @returns PullRequest object or undefined
 */
function extractPullRequest(
	arg: string | { pullRequest: PullRequest } | PullRequest | undefined,
): PullRequest | undefined {
	if (!arg || typeof arg === "string") {
		return undefined;
	}

	if ("pullRequest" in arg) {
		return arg.pullRequest;
	}

	if ("repository" in arg) {
		return arg as PullRequest;
	}

	return undefined;
}

/**
 * Helper: Build Azure DevOps PR URL
 *
 * @param pr - Pull request object
 * @param organization - Azure DevOps organization name
 * @returns Full URL to the PR in Azure DevOps web interface
 */
function buildPRUrl(pr: PullRequest, organization: string): string {
	return `https://dev.azure.com/${organization}/${pr.repository.project.name}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`;
}

/**
 * Extension activation function
 *
 * ## Initialization Flow & Component Dependencies
 *
 * The components must be initialized in this specific order due to dependencies:
 *
 * ```
 * 1. Authentication Provider (no dependencies)
 *    ↓
 * 2. Azure DevOps Client (depends on: Auth Provider)
 *    ↓
 * 3. Pull Request Provider (depends on: Client, Auth Provider)
 *    ├─ Register Tree View
 *    ↓
 * 4. Comment Controller (depends on: Client)
 *    ├─ Initialize asynchronously (non-blocking)
 *    ↓
 * 5. Comment Event Coordinator (depends on: Comment Controller)
 *    ├─ Handles document open/close events
 *    ├─ Debounces comment loading
 *    ↓
 * 6. Register Commands (depends on: all above components)
 *    ├─ Sign in/out
 *    ├─ Refresh PRs
 *    ├─ View/Open PRs
 *    ├─ Comment operations
 *    ├─ LFS cache management
 *    ↓
 * 7. Setup Auto-refresh (optional, based on config)
 * ```
 *
 * ## Critical Notes
 *
 * - **Comment Controller** is initialized asynchronously to avoid blocking extension activation
 * - **Event Coordinator** must be initialized AFTER Comment Controller to handle document events
 * - **Auto-refresh** setup happens last since it depends on PR Provider being fully initialized
 * - All disposables are collected in context.subscriptions for proper cleanup
 *
 * @param context - VS Code extension context for managing lifecycle
 */
export async function activate(context: vscode.ExtensionContext) {
	logger.info("Azure DevOps PR Viewer extension is now active");

	// Step 1: Initialize authentication provider
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

	// Initialize reviewed files service
	reviewedFilesService = ReviewedFilesService.getInstance(context);

	// Initialize Git services for branch checkout
	const gitService = new GitService();
	const gitAvailable = await gitService.initialize();

	if (!gitAvailable) {
		logger.warn("Git extension not available - checkout features disabled");
	}

	const config = vscode.workspace.getConfiguration("azureDevOpsPRViewer");
	const organization = config.get<string>("organization", "");

	const repositoryMatchingService = new RepositoryMatchingService(gitService, organization);

	const checkoutHandler = new CheckoutBranchCommandHandler(gitService, repositoryMatchingService);

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
				// Handle legacy string URL format
				if (typeof arg === "string") {
					await vscode.env.openExternal(vscode.Uri.parse(arg));
					return;
				}

				// Extract PR from various argument formats
				const pr = extractPullRequest(arg);
				if (!pr) {
					vscode.window.showErrorMessage("Unable to open PR: invalid argument");
					return;
				}

				// Build URL and open in browser
				const org = vscode.workspace
					.getConfiguration("azureDevOpsPRViewer")
					.get<string>("organization", "");
				const url = buildPRUrl(pr, org);
				await vscode.env.openExternal(vscode.Uri.parse(url));
			},
		),
		vscode.commands.registerCommand(
			"azureDevOpsPRs.viewPR",
			async (arg: { pullRequest: PullRequest } | PullRequest | undefined) => {
				// Extract PR from various argument formats
				const pr = extractPullRequest(arg);
				if (!pr) {
					vscode.window.showErrorMessage("Unable to view PR: invalid argument");
					return;
				}

				await PullRequestViewerPanel.createOrShow(
					context.extensionUri,
					azureDevOpsClient,
					pr,
					reviewedFilesService,
				);
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
		vscode.commands.registerCommand(
			"azureDevOpsPRs.checkoutBranch",
			async (arg: string | { pullRequest: PullRequest } | PullRequest | undefined) => {
				const pr = extractPullRequest(arg);
				if (!pr) {
					vscode.window.showErrorMessage("Unable to checkout: invalid PR");
					return;
				}

				await checkoutHandler.execute(pr);
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
