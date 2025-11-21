import * as vscode from "vscode";
import type {
	AzureDevOpsClient,
	PullRequest,
} from "../services/azureDevOpsClient";
import type { AzureDevOpsAuthProvider } from "../auth/authProvider";

export class PullRequestProvider
	implements vscode.TreeDataProvider<PRTreeItem>
{
	private readonly _onDidChangeTreeData: vscode.EventEmitter<
		PRTreeItem | undefined | null | void
	> = new vscode.EventEmitter<PRTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<
		PRTreeItem | undefined | null | void
	> = this._onDidChangeTreeData.event;

	private pullRequests: PullRequest[] = [];
	private hasInitialized = false;
	private isRefreshing = false;

	constructor(
		private readonly azureDevOpsClient: AzureDevOpsClient,
		private readonly authProvider: AzureDevOpsAuthProvider,
	) {}

	initialize(): void {
		this.hasInitialized = true;
		this.refresh();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: PRTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: PRTreeItem): Promise<PRTreeItem[]> {
		if (!element) {
			// Don't show anything until we've initialized (prevents flash of sign-in during load)
			if (!this.hasInitialized) {
				return [];
			}

			// Check authentication
			const isAuthenticated = await this.authProvider.isAuthenticated();

			if (!isAuthenticated) {
				// Show sign-in button
				const signInItem = new PRTreeItem(
					"Sign in to Azure DevOps PR Viewer",
					"",
					vscode.TreeItemCollapsibleState.None,
				);
				signInItem.command = {
					command: "azureDevOpsPRs.signIn",
					title: "Sign In",
					arguments: [],
				};
				signInItem.iconPath = new vscode.ThemeIcon(
					"sign-in",
					new vscode.ThemeColor("charts.blue"),
				);
				signInItem.contextValue = "signin";
				signInItem.tooltip = new vscode.MarkdownString(
					"**Sign in to Azure DevOps PR Viewer**\n\nClick to authenticate with your Microsoft account and view pull requests across your organization.",
				);
				return [signInItem];
			}

			// Root level - fetch and display PRs
			try {
				// Show cached PRs immediately if available
				if (this.pullRequests.length > 0 && !this.isRefreshing) {
					// Refresh in background
					this.fetchPullRequests()
						.then(() => {
							this.isRefreshing = false;
							this.refresh();
						})
						.catch(() => {
							this.isRefreshing = false;
						});
					this.isRefreshing = true;

					const result = this.getGroupedByProjectView();
					console.log(
						`Returning ${result.length} cached projects at root level`,
						result.map((p) => p.label),
					);
					return result;
				}

				// First load - wait for data
				await this.fetchPullRequests();

				if (this.pullRequests.length === 0) {
					return [
						new PRTreeItem(
							"No pull requests found",
							"",
							vscode.TreeItemCollapsibleState.None,
						),
					];
				}

				const result = this.getGroupedByProjectView();
				console.log(
					`Returning ${result.length} projects at root level`,
					result.map((p) => p.label),
				);
				return result;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error";
				return [
					new PRTreeItem(
						`Error: ${errorMessage}`,
						"",
						vscode.TreeItemCollapsibleState.None,
					),
				];
			}
		}

		if (element.contextValue === "project") {
			// Return repos for this project
			return element.children || [];
		}

		if (element.contextValue === "repository") {
			// Return PRs for this repo
			return element.children || [];
		}

		return [];
	}

	private async fetchPullRequests(): Promise<void> {
		this.pullRequests = await this.azureDevOpsClient.getAllPullRequests();
	}

	private getGroupedByProjectView(): PRTreeItem[] {
		// Group PRs by project and repository
		const projectMap = new Map<string, Map<string, PullRequest[]>>();

		for (const pr of this.pullRequests) {
			const projectName = pr.repository.project.name;
			const repoName = pr.repository.name;

			if (!projectMap.has(projectName)) {
				projectMap.set(projectName, new Map());
			}

			const repoMap = projectMap.get(projectName)!;
			if (!repoMap.has(repoName)) {
				repoMap.set(repoName, []);
			}

			repoMap.get(repoName)!.push(pr);
		}

		// Create tree items
		const projectItems: PRTreeItem[] = [];

		// Sort projects alphabetically
		const sortedProjects = Array.from(projectMap.entries()).sort((a, b) =>
			a[0].localeCompare(b[0]),
		);

		for (const [projectName, repoMap] of sortedProjects) {
			const repoItems: PRTreeItem[] = [];
			let projectPRCount = 0;

			// Sort repositories alphabetically
			const sortedRepos = Array.from(repoMap.entries()).sort((a, b) =>
				a[0].localeCompare(b[0]),
			);

			for (const [repoName, prs] of sortedRepos) {
				projectPRCount += prs.length;

				// Sort PRs within repo by age
				const sortedPRs = prs.toSorted(
					(a, b) => a.creationDate.getTime() - b.creationDate.getTime(),
				);

				const prItems = sortedPRs.map((pr) => this.createPRTreeItem(pr));

				const repoItem = new PRTreeItem(
					`${repoName} (${prs.length})`,
					"",
					vscode.TreeItemCollapsibleState.Collapsed,
				);
				repoItem.contextValue = "repository";
				repoItem.children = prItems;
				repoItem.iconPath = new vscode.ThemeIcon("repo");

				repoItems.push(repoItem);
			}

			const projectItem = new PRTreeItem(
				`${projectName} (${projectPRCount})`,
				"",
				vscode.TreeItemCollapsibleState.Expanded,
			);
			projectItem.contextValue = "project";
			projectItem.children = repoItems;
			projectItem.iconPath = new vscode.ThemeIcon("project");

			projectItems.push(projectItem);
		}

		return projectItems;
	}

	private createPRTreeItem(pr: PullRequest): PRTreeItem {
		const ageInDays = this.getAgeInDays(pr.creationDate);
		const ageText = this.formatAge(ageInDays);

		const label = `${pr.title}`;
		const description = `${pr.createdBy.displayName} • ${ageText}`;

		const item = new PRTreeItem(
			label,
			description,
			vscode.TreeItemCollapsibleState.None,
			pr,
		);

		// Set icon based on PR status
		if (pr.isDraft) {
			item.iconPath = new vscode.ThemeIcon("git-pull-request-draft");
		}

		if (!pr.isDraft) {
			item.iconPath = new vscode.ThemeIcon("git-pull-request");
		}

		// Set context value for menu actions
		item.contextValue = "pullrequest";

		// Make it clickable - open in webview panel
		item.command = {
			command: "azureDevOpsPRs.viewPR",
			title: "View Pull Request",
			arguments: [pr],
		};

		// Add tooltip with more details
		item.tooltip = this.createTooltip(pr, ageText);

		return item;
	}

	private createTooltip(
		pr: PullRequest,
		ageText: string,
	): vscode.MarkdownString {
		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`### ${pr.title}\n\n`);
		tooltip.appendMarkdown(`**Project:** ${pr.repository.project.name}\n\n`);
		tooltip.appendMarkdown(`**Repository:** ${pr.repository.name}\n\n`);
		tooltip.appendMarkdown(`**Author:** ${pr.createdBy.displayName}\n\n`);
		tooltip.appendMarkdown(
			`**Created:** ${pr.creationDate.toLocaleString()} (${ageText})\n\n`,
		);
		tooltip.appendMarkdown(
			`**Status:** ${pr.status}${pr.isDraft ? " (Draft)" : ""}\n\n`,
		);
		tooltip.appendMarkdown(
			`**Source:** ${pr.sourceRefName ? pr.sourceRefName.replace("refs/heads/", "") : "unknown"}\n\n`,
		);
		tooltip.appendMarkdown(
			`**Target:** ${pr.targetRefName ? pr.targetRefName.replace("refs/heads/", "") : "unknown"}\n\n`,
		);

		if (pr.reviewers && pr.reviewers.length > 0) {
			tooltip.appendMarkdown(`**Reviewers:**\n`);
			for (const reviewer of pr.reviewers) {
				const voteIcon = this.getVoteIcon(reviewer.vote);
				tooltip.appendMarkdown(`- ${voteIcon} ${reviewer.displayName}\n`);
			}
		}

		if (pr.description) {
			const shortDesc = pr.description.substring(0, 200);
			tooltip.appendMarkdown(
				`\n**Description:** ${shortDesc}${pr.description.length > 200 ? "..." : ""}\n`,
			);
		}

		return tooltip;
	}

	private getVoteIcon(vote: number): string {
		switch (vote) {
			case 10:
				return "✅"; // Approved
			case 5:
				return "👍"; // Approved with suggestions
			case 0:
				return "⏸️"; // No vote
			case -5:
				return "⏳"; // Waiting for author
			case -10:
				return "❌"; // Rejected
			default:
				return "❓";
		}
	}

	private getAgeInDays(date: Date): number {
		const now = new Date();
		const diffTime = Math.abs(now.getTime() - date.getTime());
		return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
	}

	private formatAge(days: number): string {
		if (days === 0) {
			return "today";
		}

		if (days === 1) {
			return "1 day ago";
		}

		if (days < 7) {
			return `${days} days ago`;
		}

		if (days < 14) {
			return "1 week ago";
		}

		if (days < 30) {
			const weeks = Math.floor(days / 7);
			return `${weeks} weeks ago`;
		}

		if (days < 60) {
			return "1 month ago";
		}

		const months = Math.floor(days / 30);
		return `${months} months ago`;
	}
}

class PRTreeItem extends vscode.TreeItem {
	children?: PRTreeItem[];
	pullRequest?: PullRequest;

	constructor(
		public readonly label: string,
		public readonly description: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		pullRequest?: PullRequest,
	) {
		super(label, collapsibleState);
		this.description = description;
		this.pullRequest = pullRequest;
	}
}
