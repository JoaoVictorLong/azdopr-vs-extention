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

				// Sort PRs within repo by actionability (needs review first)
				const sortedPRs = this.sortPRsByActionability(prs);

				const prItems = sortedPRs.map((pr) => this.createPRTreeItem(pr));

				// Count PRs that need current user's review
				const needsReviewCount = prs.filter((pr) => this.needsCurrentUserReview(pr)).length;

				const repoItem = new PRTreeItem(
					`${repoName} (${prs.length})`,
					"",
					needsReviewCount > 0
						? vscode.TreeItemCollapsibleState.Expanded
						: vscode.TreeItemCollapsibleState.Collapsed,
				);
				repoItem.contextValue = "repository";
				repoItem.children = prItems;
				repoItem.iconPath = new vscode.ThemeIcon("repo", new vscode.ThemeColor("charts.yellow"));

				// Add badge showing PRs needing review
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
			projectItem.iconPath = new vscode.ThemeIcon(
				"project",
				new vscode.ThemeColor("charts.purple"),
			);

			projectItems.push(projectItem);
		}

		return projectItems;
	}

	private createPRTreeItem(pr: PullRequest): PRTreeItem {
		const ageInDays = this.getAgeInDays(pr.creationDate);
		const ageText = this.formatAge(ageInDays);

		// Determine review status for clean display
		const isAuthor = this.isCurrentUserAuthor(pr);
		const needsReview = this.needsCurrentUserReview(pr);
		const myReviewStatus = this.getCurrentUserReviewStatus(pr);
		const isBlocked = this.isPRBlocked(pr);

		// Build description with status context
		const statusInfo = this.getStatusDescription(pr, isBlocked, myReviewStatus);
		const ageWarning = ageInDays >= 14 ? " • ⚠️ Stale" : ageInDays >= 7 ? " • Aging" : "";
		const description = `${pr.createdBy.displayName} • ${ageText}${ageWarning}${statusInfo}`;

		const item = new PRTreeItem(pr.title, description, vscode.TreeItemCollapsibleState.None, pr);

		// Set icon and color based on review status (visual priority system)
		item.iconPath = this.getPRIcon(pr, isAuthor, needsReview, myReviewStatus, isBlocked);

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

	private isCurrentUserAuthor(pr: PullRequest): boolean {
		if (!this.currentUserId) return false;
		return pr.createdBy.uniqueName === this.currentUserId;
	}

	private needsCurrentUserReview(pr: PullRequest): boolean {
		if (!this.currentUserId || !pr.reviewers) return false;
		const myReview = pr.reviewers.find((r) => r.uniqueName === this.currentUserId);
		// Needs review if user is a reviewer but hasn't voted yet
		return myReview !== undefined && myReview.vote === REVIEWER_VOTE.NO_VOTE;
	}

	private getCurrentUserReviewStatus(pr: PullRequest): number | null {
		if (!this.currentUserId || !pr.reviewers) return null;
		const myReview = pr.reviewers.find((r) => r.uniqueName === this.currentUserId);
		return myReview?.vote ?? null;
	}

	private isPRBlocked(pr: PullRequest): boolean {
		if (!pr.reviewers) return false;
		return pr.reviewers.some((r) => r.vote === REVIEWER_VOTE.REJECTED);
	}

	private getStatusDescription(
		_pr: PullRequest,
		isBlocked: boolean,
		myReviewStatus: number | null,
	): string {
		if (isBlocked) return " • 🚫 Blocked";
		if (myReviewStatus === REVIEWER_VOTE.WAITING_FOR_AUTHOR) return " • ⏳ Waiting";
		return "";
	}

	/**
	 * Sort PRs by actionability - most actionable first
	 * Priority: 1. Needs your review, 2. Blocked, 3. Waiting for author, 4. Reviewed, 5. Your own PRs
	 */
	private sortPRsByActionability(prs: PullRequest[]): PullRequest[] {
		return prs.toSorted((a, b) => {
			const priorityA = this.getPRActionPriority(a);
			const priorityB = this.getPRActionPriority(b);

			if (priorityA !== priorityB) {
				return priorityA - priorityB; // Lower priority number = higher in list
			}

			// Within same priority, sort by age (oldest first)
			return a.creationDate.getTime() - b.creationDate.getTime();
		});
	}

	private getPRActionPriority(pr: PullRequest): number {
		const isAuthor = this.isCurrentUserAuthor(pr);
		const needsReview = this.needsCurrentUserReview(pr);
		const isBlocked = this.isPRBlocked(pr);
		const myStatus = this.getCurrentUserReviewStatus(pr);

		// Your own PRs - lowest priority (you can't review your own)
		if (isAuthor) return 5;

		// Needs your review - highest priority
		if (needsReview) return 1;

		// Blocked PRs - show early so user knows context
		if (isBlocked) return 2;

		// Waiting for author
		if (myStatus === REVIEWER_VOTE.WAITING_FOR_AUTHOR) return 3;

		// Already reviewed
		if (myStatus === REVIEWER_VOTE.APPROVED || myStatus === REVIEWER_VOTE.APPROVED_WITH_SUGGESTIONS)
			return 4;

		// Default
		return 4;
	}

	private getPRIcon(
		pr: PullRequest,
		isAuthor: boolean,
		needsReview: boolean,
		myReviewStatus: number | null,
		isBlocked: boolean,
	): vscode.ThemeIcon {
		// Draft PRs always gray
		if (pr.isDraft) {
			return new vscode.ThemeIcon("git-pull-request-draft", new vscode.ThemeColor("charts.gray"));
		}

		// Your own PRs - blue
		if (isAuthor) {
			return new vscode.ThemeIcon("git-pull-request-create", new vscode.ThemeColor("charts.blue"));
		}

		// Blocked by rejection - red
		if (isBlocked) {
			return new vscode.ThemeIcon("git-pull-request", new vscode.ThemeColor("charts.red"));
		}

		// Needs your review - orange (high visibility)
		if (needsReview) {
			return new vscode.ThemeIcon("git-pull-request", new vscode.ThemeColor("charts.orange"));
		}

		// You approved - green
		if (
			myReviewStatus === REVIEWER_VOTE.APPROVED ||
			myReviewStatus === REVIEWER_VOTE.APPROVED_WITH_SUGGESTIONS
		) {
			return new vscode.ThemeIcon("git-pull-request", new vscode.ThemeColor("charts.green"));
		}

		// You rejected - red
		if (myReviewStatus === REVIEWER_VOTE.REJECTED) {
			return new vscode.ThemeIcon("git-pull-request", new vscode.ThemeColor("charts.red"));
		}

		// Default - green (active PR)
		return new vscode.ThemeIcon("git-pull-request", new vscode.ThemeColor("charts.green"));
	}

	private createTooltip(pr: PullRequest, ageText: string): vscode.MarkdownString {
		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`### ${pr.title}\n\n`);

		// Add your review status
		const isAuthor = this.isCurrentUserAuthor(pr);
		const needsReview = this.needsCurrentUserReview(pr);
		const myStatus = this.getCurrentUserReviewStatus(pr);
		const isBlocked = this.isPRBlocked(pr);

		tooltip.appendMarkdown("**Your Status:** ");
		if (isAuthor) {
			tooltip.appendMarkdown("🔵 You authored this PR\n\n");
		} else if (needsReview) {
			tooltip.appendMarkdown("🟠 **Needs your review**\n\n");
		} else if (
			myStatus === REVIEWER_VOTE.APPROVED ||
			myStatus === REVIEWER_VOTE.APPROVED_WITH_SUGGESTIONS
		) {
			tooltip.appendMarkdown("🟢 You approved\n\n");
		} else if (myStatus === REVIEWER_VOTE.REJECTED) {
			tooltip.appendMarkdown("🔴 You rejected\n\n");
		} else if (myStatus === REVIEWER_VOTE.WAITING_FOR_AUTHOR) {
			tooltip.appendMarkdown("⏳ Waiting for author\n\n");
		} else {
			tooltip.appendMarkdown("Not a reviewer\n\n");
		}

		if (isBlocked) {
			tooltip.appendMarkdown("⚠️ **Blocked by rejection**\n\n");
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
