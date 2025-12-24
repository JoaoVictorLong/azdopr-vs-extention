import * as vscode from "vscode";
import type { AzureDevOpsAuthProvider } from "../auth/authProvider";
import { REVIEWER_VOTE } from "../constants/azureDevOpsConstants";
import { MIN_REFRESH_INTERVAL_MS } from "../constants/cacheConfig";
import type { AzureDevOpsClient, PullRequest } from "../services/azureDevOpsClient";
import { formatErrorMessage } from "../utils/errorFormatter";

export class PullRequestProvider implements vscode.TreeDataProvider<PRTreeItem> {
	private readonly _onDidChangeTreeData: vscode.EventEmitter<
		PRTreeItem | undefined | null | undefined
	> = new vscode.EventEmitter<PRTreeItem | undefined | null | undefined>();
	readonly onDidChangeTreeData: vscode.Event<PRTreeItem | undefined | null | undefined> =
		this._onDidChangeTreeData.event;

	private pullRequests: PullRequest[] = [];
	private hasInitialized = false;
	private isRefreshing = false;
	private lastRefreshTime: number = 0;
	private readonly minRefreshIntervalMs = MIN_REFRESH_INTERVAL_MS;
	private currentUserId: string | null = null;

	constructor(
		private readonly azureDevOpsClient: AzureDevOpsClient,
		private readonly authProvider: AzureDevOpsAuthProvider,
	) {}

	initialize(): void {
		this.hasInitialized = true;
		// Fetch current user in background (don't block initialization)
		this.fetchCurrentUser().catch(() => {
			// Errors already handled in fetchCurrentUser
		});
		this.refresh();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: PRTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: PRTreeItem): Promise<PRTreeItem[]> {
		if (!element) {
			return this.getRootChildren();
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

	private async getRootChildren(): Promise<PRTreeItem[]> {
		// Don't show anything until we've initialized (prevents flash of sign-in during load)
		if (!this.hasInitialized) {
			return [];
		}

		// Check authentication
		const isAuthenticated = await this.authProvider.isAuthenticated();
		if (!isAuthenticated) {
			return this.createSignInItem();
		}

		// Root level - fetch and display PRs
		return this.fetchAndDisplayPullRequests();
	}

	private createSignInItem(): PRTreeItem[] {
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
		signInItem.iconPath = new vscode.ThemeIcon("sign-in", new vscode.ThemeColor("charts.blue"));
		signInItem.contextValue = "signin";
		signInItem.tooltip = new vscode.MarkdownString(
			"**Sign in to Azure DevOps PR Viewer**\n\nClick to authenticate with your Microsoft account and view pull requests across your organization.",
		);
		return [signInItem];
	}

	private async fetchAndDisplayPullRequests(): Promise<PRTreeItem[]> {
		try {
			// Show cached PRs immediately if available
			const hasCachedData = this.pullRequests.length > 0 && !this.isRefreshing;
			if (hasCachedData) {
				// Only trigger background refresh if enough time has passed since last refresh
				// This prevents infinite refresh loops
				const now = Date.now();
				const timeSinceLastRefresh = now - this.lastRefreshTime;
				if (timeSinceLastRefresh > this.minRefreshIntervalMs) {
					this.lastRefreshTime = now;
					this.refreshInBackground();
				}
				return this.getGroupedByProjectView();
			}

			// First load - wait for data
			this.lastRefreshTime = Date.now();
			await this.fetchPullRequests();

			if (this.pullRequests.length === 0) {
				return [new PRTreeItem("No pull requests found", "", vscode.TreeItemCollapsibleState.None)];
			}

			return this.getGroupedByProjectView();
		} catch (error) {
			const errorMessage = formatErrorMessage(error);
			return [new PRTreeItem(`Error: ${errorMessage}`, "", vscode.TreeItemCollapsibleState.None)];
		}
	}

	private refreshInBackground(): void {
		this.isRefreshing = true;
		this.fetchPullRequests()
			.then(() => {
				this.isRefreshing = false;
				// Update the last refresh time to prevent immediate re-trigger
				this.lastRefreshTime = Date.now();
				// Fire the tree data change to update the view with fresh data
				this.refresh();
			})
			.catch(() => {
				this.isRefreshing = false;
			});
	}

	private async fetchPullRequests(): Promise<void> {
		this.pullRequests = await this.azureDevOpsClient.getAllPullRequests();
	}

	/**
	 * Create hierarchical tree view grouped by Project → Repository → PRs
	 *
	 * ## Data Structure
	 *
	 * This method uses a nested Map structure to build the hierarchy:
	 *
	 * ```
	 * Map<ProjectName, Map<RepositoryName, PullRequest[]>>
	 *   │
	 *   ├─ "MyProject" →  Map<RepoName, PR[]>
	 *   │                  │
	 *   │                  ├─ "frontend" → [PR #123, PR #124]
	 *   │                  └─ "backend"  → [PR #125]
	 *   │
	 *   └─ "OtherProject" → Map<RepoName, PR[]>
	 *                       └─ "api" → [PR #126, PR #127]
	 * ```
	 *
	 * ## Sorting Strategy
	 *
	 * 1. **Projects**: Alphabetical by project name
	 * 2. **Repositories**: Alphabetical by repository name (within each project)
	 * 3. **Pull Requests**: By creation date, oldest first (within each repository)
	 *
	 * ## Tree Item Hierarchy
	 *
	 * ```
	 * Projects (expanded by default)
	 *   └─ Repositories (collapsed by default, show PR count)
	 *        └─ Individual PRs (show title, author, age)
	 * ```
	 *
	 * @returns Array of tree items representing the project hierarchy
	 */
	private getGroupedByProjectView(): PRTreeItem[] {
		// Build nested Map: Project → Repository → PRs
		const projectMap = new Map<string, Map<string, PullRequest[]>>();

		for (const pr of this.pullRequests) {
			const projectName = pr.repository.project.name;
			const repoName = pr.repository.name;

			// Get or create the repository map for this project
			let repoMap = projectMap.get(projectName);
			if (!repoMap) {
				repoMap = new Map();
				projectMap.set(projectName, repoMap);
			}

			// Get or create the PR array for this repository
			if (!repoMap.has(repoName)) {
				repoMap.set(repoName, []);
			}

			repoMap.get(repoName)?.push(pr);
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
			const sortedRepos = Array.from(repoMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

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
				repoItem.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.yellow"));

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

	private createPRTreeItem(pr: PullRequest): PRTreeItem {
		const ageInDays = this.getAgeInDays(pr.creationDate);
		const ageText = this.formatAge(ageInDays);

		// Get status badges
		const badges = this.getPRStatusBadges(pr);
		const badgePrefix = badges.length > 0 ? `${badges.join(" ")} ` : "";

		const label = `${badgePrefix}${pr.title}`;
		const description = `${pr.createdBy.displayName} • ${ageText}`;

		const item = new PRTreeItem(label, description, vscode.TreeItemCollapsibleState.None, pr);

		// Set icon based on PR status
		if (pr.isDraft) {
			item.iconPath = new vscode.ThemeIcon("git-pull-request-draft", new vscode.ThemeColor("charts.gray"));
		} else {
			item.iconPath = new vscode.ThemeIcon("git-pull-request", new vscode.ThemeColor("charts.green"));
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

	private createTooltip(pr: PullRequest, ageText: string): vscode.MarkdownString {
		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`### ${pr.title}\n\n`);

		// Add badge explanations if present
		const badges = this.getPRStatusBadges(pr);
		if (badges.length > 0) {
			tooltip.appendMarkdown("**Status:**\n");
			if (badges.includes("✅")) {
				tooltip.appendMarkdown("- ✅ You approved this PR\n");
			}
			if (badges.includes("❌")) {
				tooltip.appendMarkdown("- ❌ You rejected this PR\n");
			}
			if (badges.includes("🚫")) {
				tooltip.appendMarkdown("- 🚫 Blocked by reviewer rejection\n");
			}
			if (badges.includes("⏳")) {
				tooltip.appendMarkdown("- ⏳ Waiting for author\n");
			}
			tooltip.appendMarkdown("\n");
		}

		tooltip.appendMarkdown(`**Project:** ${pr.repository.project.name}\n\n`);
		tooltip.appendMarkdown(`**Repository:** ${pr.repository.name}\n\n`);
		tooltip.appendMarkdown(`**Author:** ${pr.createdBy.displayName}\n\n`);
		tooltip.appendMarkdown(`**Created:** ${pr.creationDate.toLocaleString()} (${ageText})\n\n`);
		tooltip.appendMarkdown(`**Status:** ${pr.status}${pr.isDraft ? " (Draft)" : ""}\n\n`);
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
			case REVIEWER_VOTE.APPROVED:
				return "✅"; // Approved
			case REVIEWER_VOTE.APPROVED_WITH_SUGGESTIONS:
				return "👍"; // Approved with suggestions
			case REVIEWER_VOTE.NO_VOTE:
				return "⏸️"; // No vote
			case REVIEWER_VOTE.WAITING_FOR_AUTHOR:
				return "⏳"; // Waiting for author
			case REVIEWER_VOTE.REJECTED:
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

	private async fetchCurrentUser(): Promise<void> {
		try {
			const user = await this.azureDevOpsClient.getCurrentUser();
			this.currentUserId = user.uniqueName; // Use email for matching
		} catch (error) {
			// Log error but don't fail - badges just won't show
			console.error("Failed to fetch current user:", error);
			this.currentUserId = null;
		}
	}

	private getPRStatusBadges(pr: PullRequest): string[] {
		const badges: string[] = [];

		if (!this.currentUserId) {
			return badges;
		}

		// Check current user's review status
		const myReview = pr.reviewers?.find((r) => r.uniqueName === this.currentUserId);
		if (myReview) {
			if (
				myReview.vote === REVIEWER_VOTE.APPROVED ||
				myReview.vote === REVIEWER_VOTE.APPROVED_WITH_SUGGESTIONS
			) {
				badges.push("✅"); // Green checkmark - you approved
			} else if (myReview.vote === REVIEWER_VOTE.REJECTED) {
				badges.push("❌"); // Red X - you rejected
			}
		}

		// Check others' review status (excluding current user)
		const othersReviews = pr.reviewers?.filter((r) => r.uniqueName !== this.currentUserId) || [];

		const hasRejection = othersReviews.some((r) => r.vote === REVIEWER_VOTE.REJECTED);
		const hasWaitingForAuthor = othersReviews.some(
			(r) => r.vote === REVIEWER_VOTE.WAITING_FOR_AUTHOR,
		);

		if (hasRejection) {
			badges.push("🚫"); // No entry sign - blocked by rejection
		} else if (hasWaitingForAuthor) {
			badges.push("⏳"); // Hourglass - waiting for author
		}

		return badges;
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
