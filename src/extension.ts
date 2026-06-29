import * as vscode from "vscode";
import { AzureDevOpsAuthProvider } from "./auth/authProvider";
import { PullRequestProvider } from "./providers/pullRequestProvider";
import { AzureDevOpsClient, type PullRequest } from "./services/azureDevOpsClient";
import { Logger } from "./utils/logger";

const logger = Logger.getInstance();

let pullRequestProvider: PullRequestProvider;
let authProvider: AzureDevOpsAuthProvider;
let refreshInterval: NodeJS.Timeout | undefined;
let azureDevOpsClient: AzureDevOpsClient;

function extractPullRequest(
	arg: string | { pullRequest: PullRequest } | PullRequest | undefined,
): PullRequest | undefined {
	if (!arg || typeof arg === "string") return undefined;
	if ("pullRequest" in arg) return arg.pullRequest;
	if ("repository" in arg) return arg as PullRequest;
	return undefined;
}

function buildPRUrl(pr: PullRequest, organization: string): string {
	return `https://dev.azure.com/${organization}/${pr.repository.project.name}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`;
}

export async function activate(context: vscode.ExtensionContext) {
	logger.info("Azure DevOps PR Viewer (Simple) is now active");

	authProvider = new AzureDevOpsAuthProvider();

	const isAuthenticated = await authProvider.isAuthenticated();
	await vscode.commands.executeCommand("setContext", "azureDevOpsPRs:authenticated", isAuthenticated);

	if (authProvider.isPatAuth()) {
		logger.info("PAT authentication configured");
	}

	azureDevOpsClient = new AzureDevOpsClient(authProvider);
	pullRequestProvider = new PullRequestProvider(azureDevOpsClient, authProvider);
	vscode.window.registerTreeDataProvider("azureDevOpsPRs", pullRequestProvider);

	const refreshPullRequests = () => {
		azureDevOpsClient.clearCache();
		pullRequestProvider.refresh();
	};

	const signIn = async () => {
		try {
			await authProvider.signIn();
			await vscode.commands.executeCommand("setContext", "azureDevOpsPRs:authenticated", true);
			vscode.window.showInformationMessage("Successfully signed in to Azure DevOps PR Viewer");
			pullRequestProvider.refresh();
		} catch (error) {
			vscode.window.showErrorMessage(`Sign in failed: ${error}`);
		}
	};

	const signOut = async () => {
		await authProvider.signOut();
		await vscode.commands.executeCommand("setContext", "azureDevOpsPRs:authenticated", false);
		vscode.window.showInformationMessage("Signed out from Azure DevOps PR Viewer");
		pullRequestProvider.refresh();
	};

	const openInBrowser = async (
		arg: string | { pullRequest: PullRequest } | PullRequest | undefined,
	) => {
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
	};

	const voteOnPR = (vote: number) => async (arg: unknown) => {
		const pr = extractPullRequest(arg as Parameters<typeof extractPullRequest>[0]);
		if (!pr) {
			vscode.window.showErrorMessage("Unable to vote: invalid argument");
			return;
		}
		try {
			await azureDevOpsClient.voteOnPullRequest(pr, vote);
			const labels: Record<number, string> = {
				10: "Approved",
				5: "Approved with suggestions",
				0: "Reset vote",
				[-5]: "Waiting for author",
				[-10]: "Rejected",
			};
			vscode.window.showInformationMessage(`Vote: ${labels[vote] || vote} on PR #${pr.pullRequestId}`);
			azureDevOpsClient.clearCache();
			pullRequestProvider.refresh();
		} catch (error) {
			vscode.window.showErrorMessage(`Vote failed: ${error}`);
		}
	};

	const viewPRDetails = async (arg: { pullRequest: PullRequest } | PullRequest | undefined) => {
		const pr = extractPullRequest(arg);
		if (!pr) {
			vscode.window.showErrorMessage("Unable to view PR: invalid argument");
			return;
		}
		PRDetailPanel.createOrShow(context.extensionUri, pr, authProvider);
	};

	context.subscriptions.push(
		vscode.commands.registerCommand("azureDevOpsPRs.refresh", refreshPullRequests),
		vscode.commands.registerCommand("azureDevOpsPRs.signIn", signIn),
		vscode.commands.registerCommand("azureDevOpsPRs.signOut", signOut),
		vscode.commands.registerCommand("azureDevOpsPRs.openPR", openInBrowser),
		vscode.commands.registerCommand("azureDevOpsPRs.viewPR", viewPRDetails),
		vscode.commands.registerCommand("azureDevOpsPRs.approve", voteOnPR(10)),
		vscode.commands.registerCommand("azureDevOpsPRs.approveWithSuggestions", voteOnPR(5)),
		vscode.commands.registerCommand("azureDevOpsPRs.reject", voteOnPR(-10)),
		vscode.commands.registerCommand("azureDevOpsPRs.waitForAuthor", voteOnPR(-5)),
		vscode.commands.registerCommand("azureDevOpsPRs.resetVote", voteOnPR(0)),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("azureDevOpsPRViewer.autoRefreshInterval")) {
				setupAutoRefresh();
			}
		}),
		vscode.authentication.onDidChangeSessions(async (e) => {
			if (e.provider.id === "microsoft" && !authProvider.isPatAuth()) {
				const isAuthenticated = await authProvider.isAuthenticated();
				await vscode.commands.executeCommand("setContext", "azureDevOpsPRs:authenticated", isAuthenticated);
				pullRequestProvider.refresh();
			}
		}),
	);

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
		refreshInterval = setInterval(() => pullRequestProvider.refresh(), interval * 1000);
	}
}

export function deactivate() {
	if (refreshInterval) clearInterval(refreshInterval);
}

class PRDetailPanel {
	static current: PRDetailPanel | undefined;
	private panel: vscode.WebviewPanel;

	private constructor(panel: vscode.WebviewPanel) {
		this.panel = panel;
	}

	static createOrShow(extensionUri: vscode.Uri, pr: PullRequest, auth: AzureDevOpsAuthProvider) {
		if (PRDetailPanel.current) {
			PRDetailPanel.current.panel.reveal(vscode.ViewColumn.Beside);
			PRDetailPanel.current.render(pr, auth.isPatAuth());
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			"azdoPrDetail",
			`PR #${pr.pullRequestId}`,
			vscode.ViewColumn.Beside,
			{ enableScripts: true },
		);

		PRDetailPanel.current = new PRDetailPanel(panel);
		PRDetailPanel.current.render(pr, auth.isPatAuth());

		panel.webview.onDidReceiveMessage((msg) => {
			if (msg.type === "vote" && typeof msg.vote === "number") {
				vscode.commands.executeCommand(
					msg.vote === 10 ? "azureDevOpsPRs.approve" :
					msg.vote === 5 ? "azureDevOpsPRs.approveWithSuggestions" :
					msg.vote === -10 ? "azureDevOpsPRs.reject" :
					msg.vote === -5 ? "azureDevOpsPRs.waitForAuthor" :
					"azureDevOpsPRs.resetVote",
					{ pullRequest: pr },
				);
			}
		});

		panel.onDidDispose(() => {
			PRDetailPanel.current = undefined;
		});
	}

	private render(pr: PullRequest, isPat: boolean) {
		const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

		const reviewerRows = (pr.reviewers || [])
			.map((r) => {
				const voteIcon = r.vote === 10 ? "✅" : r.vote === 5 ? "👍" : r.vote === -5 ? "⏳" : r.vote === -10 ? "❌" : "⬜";
				const required = r.isRequired ? " (required)" : "";
				return `<tr><td>${voteIcon}</td><td>${r.displayName}${required}</td></tr>`;
			})
			.join("");

		const draftBadge = pr.isDraft ? '<span style="background:#666;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px">Draft</span>' : "";

		this.panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 16px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
h1 { font-size: 18px; margin: 0 0 4px; }
.meta { color: var(--vscode-descriptionForeground); font-size: 13px; margin-bottom: 16px; }
.section { margin-bottom: 16px; }
.section h2 { font-size: 14px; font-weight: 600; margin: 0 0 8px; }
.desc { white-space: pre-wrap; font-size: 13px; line-height: 1.5; background: var(--vscode-textBlockQuote-background); padding: 12px; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
td { padding: 4px 8px; }
.label { color: var(--vscode-descriptionForeground); width: 100px; }
.branches { font-family: monospace; font-size: 13px; }
.pat-notice { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 16px; font-style: italic; }
.vote-row { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
.vote-btn { padding: 6px 14px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; cursor: pointer; font-size: 13px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.vote-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.vote-btn.approve { background: #2ea043; color: #fff; }
.vote-btn.approve:hover { background: #3fb950; }
.vote-btn.reject { background: #da3633; color: #fff; }
.vote-btn.reject:hover { background: #f85149; }
.vote-btn.wait { background: #d29922; color: #fff; }
.vote-btn.wait:hover { background: #e3b341; }
</style>
</head>
<body>
<h1>${pr.title} ${draftBadge}</h1>
<div class="meta">#${pr.pullRequestId} opened ${fmtDate(pr.creationDate)} by ${pr.createdBy.displayName}</div>

<div class="vote-row">
<button class="vote-btn approve" onclick="vote(10)">✅ Approve</button>
<button class="vote-btn" onclick="vote(5)">👍 Approve w/ Suggestions</button>
<button class="vote-btn reject" onclick="vote(-10)">❌ Reject</button>
<button class="vote-btn wait" onclick="vote(-5)">⏳ Wait for Author</button>
<button class="vote-btn" onclick="vote(0)">↩ Reset Vote</button>
</div>

<div class="section">
<h2>Branches</h2>
<div class="branches">${pr.sourceRefName.replace("refs/heads/", "")} → ${pr.targetRefName.replace("refs/heads/", "")}</div>
</div>

${pr.description ? `<div class="section"><h2>Description</h2><div class="desc">${this.escapeHtml(pr.description)}</div></div>` : ""}

<div class="section">
<h2>Reviewers (${pr.reviewers?.length || 0})</h2>
<table>${reviewerRows}</table>
</div>

${isPat ? '<div class="pat-notice">Using PAT authentication — comments and avatars are not available</div>' : ""}
<script>
const api = acquireVsCodeApi();
function vote(val) { api.postMessage({ type: "vote", vote: val }); }
</script>
</body>
</html>`;
	}

	private escapeHtml(text: string): string {
		return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}
}
