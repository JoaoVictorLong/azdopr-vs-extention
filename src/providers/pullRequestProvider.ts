import * as vscode from "vscode";
import type { AzureDevOpsAuthProvider } from "../auth/authProvider";
import type { AzureDevOpsClient, PullRequest } from "../services/azureDevOpsClient";
import { Logger } from "../utils/logger";

const logger = Logger.getInstance();

export class PullRequestProvider implements vscode.TreeDataProvider<PRTreeItem> {
	private readonly _onDidChangeTreeData: vscode.EventEmitter<PRTreeItem | undefined | null> =
		new vscode.EventEmitter<PRTreeItem | undefined | null>();
	readonly onDidChangeTreeData: vscode.Event<PRTreeItem | undefined | null> =
		this._onDidChangeTreeData.event;

	private pullRequests: PullRequest[] = [];
	private hasInitialized = false;
	private isRefreshing = false;
	private currentUserId: string | null = null;

	constructor(
		private readonly azureDevOpsClient: AzureDevOpsClient,
		private readonly authProvider: AzureDevOpsAuthProvider,
	) {}

	async initialize(): Promise<void> {
		this.hasInitialized = true;
		await this.fetchCurrentUser();
		this.refresh();
	}

	refresh(): void {
		if (this.isRefreshing) return;
		this.isRefreshing = true;
		this.fetchPullRequests()
			.then(() => {
				this.isRefreshing = false;
				this._onDidChangeTreeData.fire(undefined);
			})
			.catch((error) => {
				this.isRefreshing = false;
				logger.error("Failed to refresh PRs", error);
			});
	}

	getTreeItem(element: PRTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: PRTreeItem): Promise<PRTreeItem[]> {
		if (!element) return this.getRootChildren();
		return element.children || [];
	}

	private async getRootChildren(): Promise<PRTreeItem[]> {
		if (!this.hasInitialized) return [];

		const isAuthenticated = await this.authProvider.isAuthenticated();
		if (!isAuthenticated) return [this.createSignInItem()];

		if (this.pullRequests.length === 0) {
			const filter = vscode.workspace
				.getConfiguration("azureDevOpsPRViewer")
				.get<string>("prFilter", "all");
			const msg = filter === "all" ? "No pull requests found" : `No pull requests matching "${filter}" filter`;
			return [new PRTreeItem(msg, "", vscode.TreeItemCollapsibleState.None)];
		}

		return this.getGroupedByProjectView();
	}

	private createSignInItem(): PRTreeItem {
		const item = new PRTreeItem("Sign in to Azure DevOps", "", vscode.TreeItemCollapsibleState.None);
		item.command = { command: "azureDevOpsPRs.signIn", title: "Sign In" };
		item.iconPath = new vscode.ThemeIcon("sign-in");
		return item;
	}

	private async fetchPullRequests(): Promise<void> {
		try {
			this.pullRequests = await this.azureDevOpsClient.getAllPullRequests();
		} catch (error) {
			logger.error("Failed to fetch pull requests", error);
			this.pullRequests = [];
		}

		const filter = vscode.workspace
			.getConfiguration("azureDevOpsPRViewer")
			.get<string>("prFilter", "all");

		if (filter !== "all" && this.currentUserId) {
			this.pullRequests = this.pullRequests.filter((pr) => {
				switch (filter) {
					case "createdByMe":
						return pr.createdBy.uniqueName === this.currentUserId;
					case "needsMyReview":
						return this.needsCurrentUserReview(pr);
					case "assignedToMe":
						return pr.reviewers?.some((r) => r.uniqueName === this.currentUserId) ?? false;
					case "createdOrAssigned":
						return (
							pr.createdBy.uniqueName === this.currentUserId ||
							(pr.reviewers?.some((r) => r.uniqueName === this.currentUserId) ?? false)
						);
					default:
						return true;
				}
			});
		}
	}

	private async fetchCurrentUser(): Promise<void> {
		try {
			const user = await this.azureDevOpsClient.getCurrentUser();
			this.currentUserId = user.uniqueName;
		} catch (error) {
			logger.warn("Failed to fetch current user", error);
			this.currentUserId = null;
		}
	}

	private needsCurrentUserReview(pr: PullRequest): boolean {
		if (!this.currentUserId || !pr.reviewers) return false;
		return pr.reviewers.some((r) => r.uniqueName === this.currentUserId && r.vote === 0);
	}

	private getGroupedByProjectView(): PRTreeItem[] {
		const projectMap = new Map<string, Map<string, PullRequest[]>>();

		for (const pr of this.pullRequests) {
			const projectName = pr.repository.project.name;
			const repoName = pr.repository.name;

			let repoMap = projectMap.get(projectName);
			if (!repoMap) {
				repoMap = new Map();
				projectMap.set(projectName, repoMap);
			}
			if (!repoMap.has(repoName)) repoMap.set(repoName, []);
			repoMap.get(repoName)?.push(pr);
		}

		const projectItems: PRTreeItem[] = [];

		for (const [projectName, repoMap] of Array.from(projectMap.entries()).sort((a, b) =>
			a[0].localeCompare(b[0]),
		)) {
			const repoItems: PRTreeItem[] = [];
			let projectPRCount = 0;

			for (const [repoName, prs] of Array.from(repoMap.entries()).sort((a, b) =>
				a[0].localeCompare(b[0]),
			)) {
				projectPRCount += prs.length;
				const sortedPRs = this.sortPRsByActionability(prs);

				const needsReviewCount = prs.filter((pr) => this.needsCurrentUserReview(pr)).length;

				const repoItem = new PRTreeItem(
					`${repoName} (${prs.length})`,
					"",
					needsReviewCount > 0
						? vscode.TreeItemCollapsibleState.Expanded
						: vscode.TreeItemCollapsibleState.Collapsed,
				);
				repoItem.contextValue = "repository";
				repoItem.children = sortedPRs.map((pr) => this.createPRTreeItem(pr));
				repoItem.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.yellow"));

				if (needsReviewCount > 0) {
					repoItem.badge = {
						value: needsReviewCount,
						tooltip: `${needsReviewCount} PR${needsReviewCount > 1 ? "s" : ""} need your review`,
					};
				}
				repoItems.push(repoItem);
			}

			const projectItem = new PRTreeItem(
				`${projectName} (${projectPRCount})`,
				"",
				vscode.TreeItemCollapsibleState.Expanded,
			);
			projectItem.contextValue = "project";
			projectItem.children = repoItems;
			projectItem.iconPath = new vscode.ThemeIcon("project", new vscode.ThemeColor("charts.purple"));
			projectItems.push(projectItem);
		}

		return projectItems;
	}

	private sortPRsByActionability(prs: PullRequest[]): PullRequest[] {
		return [...prs].sort((a, b) => {
			const aNeedsReview = this.needsCurrentUserReview(a);
			const bNeedsReview = this.needsCurrentUserReview(b);
			if (aNeedsReview && !bNeedsReview) return -1;
			if (!aNeedsReview && bNeedsReview) return 1;
			const aIsDraft = a.isDraft ? 1 : 0;
			const bIsDraft = b.isDraft ? 1 : 0;
			return aIsDraft - bIsDraft;
		});
	}

	private createPRTreeItem(pr: PullRequest): PRTreeItem {
		const needsReview = this.needsCurrentUserReview(pr);
		const prefix = needsReview ? "🔔 " : pr.isDraft ? "📝 " : "";
		const title = `${prefix}${pr.title}`;
		const description = `#${pr.pullRequestId} by ${pr.createdBy.displayName}`;

		const item = new PRTreeItem(title, description, vscode.TreeItemCollapsibleState.None);
		item.contextValue = "pullrequest";
		item.pullRequest = pr;
		item.iconPath = new vscode.ThemeIcon(needsReview ? "bell" : "git-pull-request");
		item.tooltip = new vscode.MarkdownString(
			`**${pr.title}**  \n#${pr.pullRequestId} by ${pr.createdBy.displayName}  \n${pr.sourceRefName.replace("refs/heads/", "")} → ${pr.targetRefName.replace("refs/heads/", "")}  \nReviewers: ${pr.reviewers?.length || 0}`,
		);

		item.command = {
			command: "azureDevOpsPRs.viewPR",
			title: "View PR",
			arguments: [{ pullRequest: pr }],
		};

		return item;
	}
}

class PRTreeItem extends vscode.TreeItem {
	children?: PRTreeItem[];
	pullRequest?: PullRequest;
	declare badge?: { value: number; tooltip?: string };

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
