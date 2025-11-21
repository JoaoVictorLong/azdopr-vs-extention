import * as vscode from "vscode";
import { AzureDevOpsAuthProvider } from "./auth/authProvider";
import { PullRequestProvider } from "./providers/pullRequestProvider";
import {
	AzureDevOpsClient,
	type PullRequest,
} from "./services/azureDevOpsClient";
import { PullRequestViewerPanel } from "./views/pullRequestViewerPanel";
import { PRCommentController } from "./providers/prCommentController";

let pullRequestProvider: PullRequestProvider;
let authProvider: AzureDevOpsAuthProvider;
let refreshInterval: NodeJS.Timeout | undefined;
let azureDevOpsClient: AzureDevOpsClient;
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
		commentController,
		vscode.commands.registerCommand("azureDevOpsPRs.refresh", () => {
			azureDevOpsClient.clearCache();
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
