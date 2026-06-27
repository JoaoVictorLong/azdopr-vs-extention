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
let reviewedFilesService: ReviewedFilesService;

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

function buildPRUrl(pr: PullRequest, organization: string): string {
	return `https://dev.azure.com/${organization}/${pr.repository.project.name}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`;
}

export async function activate(context: vscode.ExtensionContext) {
	logger.info("Azure DevOps PR Viewer extension is now active");

	authProvider = new AzureDevOpsAuthProvider();

	const isAuthenticated = await authProvider.isAuthenticated();
	await vscode.commands.executeCommand(
		"setContext",
		"azureDevOpsPRs:authenticated",
		isAuthenticated,
	);

	if (authProvider.isPatAuth()) {
		logger.info("PAT authentication configured");
	}

	azureDevOpsClient = new AzureDevOpsClient(authProvider);
	pullRequestProvider = new PullRequestProvider(azureDevOpsClient, authProvider);
	vscode.window.registerTreeDataProvider("azureDevOpsPRs", pullRequestProvider);

	commentController = new PRCommentController(azureDevOpsClient);
	commentController.initialize(); // Non-blocking async init

	commentEventCoordinator = new CommentEventCoordinator(commentController);
	reviewedFilesService = ReviewedFilesService.getInstance(context);

	const gitService = new GitService();
	const gitAvailable = await gitService.initialize();

	if (!gitAvailable) {
		logger.warn("Git extension not available - checkout features disabled");
	}

	const config = vscode.workspace.getConfiguration("azureDevOpsPRViewer");
	const organization = config.get<string>("organization", "");

	const repositoryMatchingService = new RepositoryMatchingService(gitService, organization);

	const checkoutHandler = new CheckoutBranchCommandHandler(gitService, repositoryMatchingService);

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
				if (typeof arg === "string") {
					await vscode.env.openExternal(vscode.Uri.parse(arg));
					return;
				}

				const pr = extractPullRequest(arg);
				if (!pr) {
					vscode.window.showErrorMessage("Unable to open PR: invalid argument");
					return;
				}

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
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("azureDevOpsPRViewer.autoRefreshInterval")) {
				setupAutoRefresh();
			}
		}),
		vscode.authentication.onDidChangeSessions(async (e) => {
			if (e.provider.id === "microsoft" && !authProvider.isPatAuth()) {
				const isAuthenticated = await authProvider.isAuthenticated();
				await vscode.commands.executeCommand(
					"setContext",
					"azureDevOpsPRs:authenticated",
					isAuthenticated,
				);
				pullRequestProvider.refresh();
			}
		}),

		// Comment event listeners - required for inline PR comments in diff views
		vscode.workspace.onDidOpenTextDocument(
			commentEventCoordinator.handleDocumentEvent.bind(commentEventCoordinator),
		),

		vscode.window.onDidChangeActiveTextEditor(
			commentEventCoordinator.handleEditorChange.bind(commentEventCoordinator),
		),

		vscode.workspace.onDidCloseTextDocument(
			commentEventCoordinator.handleDocumentClose.bind(commentEventCoordinator),
		),

		commentEventCoordinator,
	];

	context.subscriptions.push(...subscriptions);
	setupAutoRefresh();
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
