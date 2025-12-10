import * as vscode from "vscode";
import type {
	AzureDevOpsClient,
	PullRequest,
	PRThread,
	PRComment,
	PRUpdate,
} from "../services/azureDevOpsClient";
import {
	formatTimeAgo,
	getThreadStatusLabel,
} from "../utils/commentFormatter";

type SortMode = "date" | "file" | "status";

export class PRCommentsProvider
	implements vscode.TreeDataProvider<CommentTreeItem>
{
	private readonly _onDidChangeTreeData: vscode.EventEmitter<
		CommentTreeItem | undefined | null | void
	> = new vscode.EventEmitter<CommentTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<
		CommentTreeItem | undefined | null | void
	> = this._onDidChangeTreeData.event;

	private currentPR: PullRequest | undefined;
	private threads: PRThread[] = [];
	private updates: PRUpdate[] = [];
	private sortMode: SortMode = "date";
	private autoRefreshInterval: NodeJS.Timeout | undefined;

	constructor(private readonly azureDevOpsClient: AzureDevOpsClient) {
		// Listen for PR context changes
		this.setupAutoRefresh();

		// Watch for configuration changes
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (
				e.affectsConfiguration(
					"azureDevOpsPRViewer.commentsAutoRefreshInterval",
				)
			) {
				this.setupAutoRefresh();
			}
		});
	}

	/**
	 * Set the current PR to display comments for
	 */
	public setCurrentPR(pr: PullRequest | undefined): void {
		this.currentPR = pr;
		this.refresh();
	}

	/**
	 * Get the current PR
	 */
	public getCurrentPR(): PullRequest | undefined {
		return this.currentPR;
	}

	/**
	 * Refresh the comments view
	 */
	public async refresh(): Promise<void> {
		if (!this.currentPR) {
			this.threads = [];
			this.updates = [];
			this._onDidChangeTreeData.fire();
			return;
		}

		try {
			// Fetch both threads and updates in parallel
			const [threads, updates] = await Promise.all([
				this.azureDevOpsClient.getPullRequestThreads(
					this.currentPR.repository.project.id,
					this.currentPR.repository.id,
					this.currentPR.pullRequestId,
				),
				this.azureDevOpsClient.getPullRequestUpdates(
					this.currentPR.repository.project.id,
					this.currentPR.repository.id,
					this.currentPR.pullRequestId,
				),
			]);

			this.threads = threads;
			this.updates = updates;

			console.log(
				`Fetched ${this.threads.length} threads and ${this.updates.length} updates for PR #${this.currentPR.pullRequestId}`,
			);

			// Debug: Log threads with no comments
			const emptyThreads = this.threads.filter(
				(t) => !t.comments || t.comments.length === 0,
			);
			if (emptyThreads.length > 0) {
				console.log(
					`Found ${emptyThreads.length} threads with no comments:`,
					emptyThreads,
				);
			}
		} catch (error) {
			console.error("Failed to fetch PR data:", error);
			this.threads = [];
			this.updates = [];
		}

		this._onDidChangeTreeData.fire();
	}

	/**
	 * Set the sort mode for comments
	 */
	public setSortMode(mode: SortMode): void {
		this.sortMode = mode;
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Setup auto-refresh polling
	 */
	private setupAutoRefresh(): void {
		// Clear existing interval
		if (this.autoRefreshInterval) {
			clearInterval(this.autoRefreshInterval);
			this.autoRefreshInterval = undefined;
		}

		const config = vscode.workspace.getConfiguration("azureDevOpsPRViewer");
		const interval = config.get<number>("commentsAutoRefreshInterval", 30);

		if (interval > 0) {
			this.autoRefreshInterval = setInterval(() => {
				this.refresh();
			}, interval * 1000);
		}
	}

	/**
	 * Dispose of resources
	 */
	public dispose(): void {
		if (this.autoRefreshInterval) {
			clearInterval(this.autoRefreshInterval);
		}
	}

	getTreeItem(element: CommentTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: CommentTreeItem): Promise<CommentTreeItem[]> {
		if (!element) {
			// Root level
			if (!this.currentPR) {
				return [
					new CommentTreeItem(
						"No PR selected",
						"Select a PR to view comments",
						vscode.TreeItemCollapsibleState.None,
						"info",
					),
				];
			}

			if (this.threads.length === 0 && this.updates.length === 0) {
				return [
					new CommentTreeItem(
						"No comments or updates found",
						`PR #${this.currentPR.pullRequestId} has no activity`,
						vscode.TreeItemCollapsibleState.None,
						"info",
					),
				];
			}

			return this.getCombinedView();
		}

		if (element.contextValue === "thread") {
			// Return comments for this thread
			return element.children || [];
		}

		return [];
	}

	private getCombinedView(): CommentTreeItem[] {
		// For now, when sorting by date, interleave updates and threads
		if (this.sortMode === "date") {
			return this.getInterleavedView();
		}
		// For other sort modes, just show threads (updates don't have files or statuses)
		return this.getThreadsView();
	}

	private getInterleavedView(): CommentTreeItem[] {
		// Convert updates to items
		const updateItems = this.updates.map((update) =>
			this.createUpdateItem(update),
		);

		// Convert threads to items
		const threadItems = this.threads.map((thread) =>
			this.createThreadItem(thread),
		);

		// Combine and sort by date
		const allItems = [...updateItems, ...threadItems];
		allItems.sort((a, b) => {
			const dateA = a.sortDate || new Date(0);
			const dateB = b.sortDate || new Date(0);
			return dateB.getTime() - dateA.getTime();
		});

		return allItems;
	}

	private getThreadsView(): CommentTreeItem[] {
		const sortedThreads = this.sortThreads([...this.threads]);

		if (this.sortMode === "file") {
			return this.getThreadsViewByFile(sortedThreads);
		}

		if (this.sortMode === "status") {
			return this.getThreadsViewByStatus(sortedThreads);
		}

		// Flat view sorted by date (default)
		return this.getThreadsViewFlat(sortedThreads);
	}

	private getThreadsViewByFile(sortedThreads: PRThread[]): CommentTreeItem[] {
		const fileGroups = this.groupThreadsByFile(sortedThreads);
		const items: CommentTreeItem[] = [];

		for (const [filePath, threads] of fileGroups) {
			const fileItem = new CommentTreeItem(
				this.getFileName(filePath),
				`${threads.length} thread${threads.length === 1 ? "" : "s"}`,
				vscode.TreeItemCollapsibleState.Expanded,
				"file",
			);
			fileItem.iconPath = new vscode.ThemeIcon("file");
			fileItem.children = threads.map((thread) =>
				this.createThreadItem(thread),
			);
			items.push(fileItem);
		}

		return items;
	}

	private getThreadsViewByStatus(sortedThreads: PRThread[]): CommentTreeItem[] {
		const statusGroups = this.groupThreadsByStatus(sortedThreads);
		const items: CommentTreeItem[] = [];

		for (const [status, threads] of statusGroups) {
			const statusItem = new CommentTreeItem(
				status,
				`${threads.length} thread${threads.length === 1 ? "" : "s"}`,
				vscode.TreeItemCollapsibleState.Expanded,
				"status",
			);
			statusItem.iconPath = this.getStatusIcon(status);
			statusItem.children = threads.map((thread) =>
				this.createThreadItem(thread),
			);
			items.push(statusItem);
		}

		return items;
	}

	private getThreadsViewFlat(sortedThreads: PRThread[]): CommentTreeItem[] {
		return sortedThreads.map((thread) => this.createThreadItem(thread));
	}

	private groupThreadsByFile(threads: PRThread[]): Map<string, PRThread[]> {
		const fileGroups = new Map<string, PRThread[]>();

		for (const thread of threads) {
			const filePath = thread.threadContext?.filePath || "General Comments";
			if (!fileGroups.has(filePath)) {
				fileGroups.set(filePath, []);
			}
			fileGroups.get(filePath)?.push(thread);
		}

		return fileGroups;
	}

	private groupThreadsByStatus(threads: PRThread[]): Map<string, PRThread[]> {
		const statusGroups = new Map<string, PRThread[]>();

		for (const thread of threads) {
			const status = getThreadStatusLabel(thread.status);
			if (!statusGroups.has(status)) {
				statusGroups.set(status, []);
			}
			statusGroups.get(status)?.push(thread);
		}

		return statusGroups;
	}

	private sortThreads(threads: PRThread[]): PRThread[] {
		return threads.sort((a, b) => {
			if (this.sortMode === "date") {
				return b.lastUpdatedDate.getTime() - a.lastUpdatedDate.getTime();
			} else if (this.sortMode === "file") {
				const fileA = a.threadContext?.filePath || "";
				const fileB = b.threadContext?.filePath || "";
				return fileA.localeCompare(fileB);
			} else if (this.sortMode === "status") {
				return a.status.localeCompare(b.status);
			}
			return 0;
		});
	}

	private createThreadItem(thread: PRThread): CommentTreeItem {
		// Handle threads without comments (system activity updates)
		if (!thread.comments || thread.comments.length === 0) {
			const label = "System Activity";
			const description = formatTimeAgo(thread.lastUpdatedDate);

			const item = new CommentTreeItem(
				label,
				description,
				vscode.TreeItemCollapsibleState.None,
				"thread",
			);

			item.iconPath = new vscode.ThemeIcon("info");
			item.tooltip = `System activity from ${thread.publishedDate.toLocaleString()}`;
			item.thread = thread;
			item.sortDate = thread.lastUpdatedDate;

			return item;
		}

		const firstComment = thread.comments[0];
		const commentCount = thread.comments.length;

		// Handle comments without content or author (defensive)
		const authorName = firstComment.author?.displayName || "[Author name unavailable]";
		const content = firstComment.content || "[No content]";

		// Create label with first comment preview
		const preview = this.getCommentPreview(content);
		const label = `${authorName}: ${preview}`;

		// Create description with metadata
		const parts: string[] = [];

		// Add file and line info if available
		if (thread.threadContext?.filePath) {
			const fileName = this.getFileName(thread.threadContext.filePath);
			const lineNumber =
				thread.threadContext.rightFileStart?.line ||
				thread.threadContext.rightFileEnd?.line;
			if (lineNumber) {
				parts.push(`${fileName}:${lineNumber}`);
			}

			if (!lineNumber) {
				parts.push(fileName);
			}
		}

		// Add status
		parts.push(getThreadStatusLabel(thread.status));

		// Add comment count if more than 1
		if (commentCount > 1) {
			parts.push(`${commentCount} replies`);
		}

		// Add timestamp
		parts.push(formatTimeAgo(thread.lastUpdatedDate));

		const description = parts.join(" • ");

		const item = new CommentTreeItem(
			label,
			description,
			commentCount > 1
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None,
			"thread",
		);

		item.iconPath = this.getStatusIcon(
			getThreadStatusLabel(thread.status),
		);
		item.tooltip = this.createThreadTooltip(thread);
		item.thread = thread;
		item.sortDate = thread.lastUpdatedDate;

		// Add child comments if there are replies
		if (commentCount > 1) {
			item.children = thread.comments
				.slice(1)
				.map((comment) => this.createCommentItem(comment, thread));
		}

		return item;
	}

	private createUpdateItem(update: PRUpdate): CommentTreeItem {
		const description = formatTimeAgo(update.createdDate);
		const label = update.description || "PR Update";

		const item = new CommentTreeItem(
			label,
			description,
			vscode.TreeItemCollapsibleState.None,
			"update",
		);

		item.iconPath = new vscode.ThemeIcon(
			"git-commit",
			new vscode.ThemeColor("charts.blue"),
		);
		item.tooltip = `${update.createdBy?.displayName || "[User name unavailable]"} - ${update.createdDate.toLocaleString()}`;
		item.sortDate = update.createdDate;

		return item;
	}

	private createCommentItem(
		comment: PRComment,
		thread: PRThread,
	): CommentTreeItem {
		const preview = this.getCommentPreview(comment.content || "");
		const authorName = comment.author?.displayName || "[Author name unavailable]";
		const label = `${authorName}: ${preview}`;
		const description = formatTimeAgo(comment.publishedDate);

		const item = new CommentTreeItem(
			label,
			description,
			vscode.TreeItemCollapsibleState.None,
			"comment",
		);

		item.iconPath = new vscode.ThemeIcon("comment");
		item.tooltip = this.createCommentTooltip(comment);
		item.comment = comment;
		item.thread = thread;

		return item;
	}

	private getCommentPreview(content: string, maxLength: number = 80): string {
		// Remove markdown and extra whitespace
		const cleaned = content
			.replaceAll(/[#*_`]/g, "")
			.replaceAll(/\s+/g, " ")
			.trim();
		if (cleaned.length <= maxLength) {
			return cleaned;
		}
		return `${cleaned.substring(0, maxLength - 3)}...`;
	}

	private getFileName(filePath: string): string {
		const parts = filePath.split("/");
		return parts.at(-1) || filePath;
	}


	private getStatusIcon(statusLabel: string): vscode.ThemeIcon {
		switch (statusLabel.toLowerCase()) {
			case "active":
				return new vscode.ThemeIcon(
					"comment-discussion",
					new vscode.ThemeColor("charts.yellow"),
				);
			case "resolved":
			case "closed":
				return new vscode.ThemeIcon(
					"pass",
					new vscode.ThemeColor("charts.green"),
				);
			case "pending":
				return new vscode.ThemeIcon(
					"clock",
					new vscode.ThemeColor("charts.blue"),
				);
			default:
				return new vscode.ThemeIcon("comment");
		}
	}


	private createThreadTooltip(thread: PRThread): vscode.MarkdownString {
		const tooltip = new vscode.MarkdownString();
		tooltip.isTrusted = true;

		const firstComment = thread.comments[0];
		tooltip.appendMarkdown(`**${firstComment.author.displayName}**\n\n`);
		tooltip.appendMarkdown(`${firstComment.content}\n\n`);
		tooltip.appendMarkdown(`---\n\n`);
		tooltip.appendMarkdown(
			`**Status:** ${getThreadStatusLabel(thread.status)}\n\n`,
		);

		if (thread.threadContext?.filePath) {
			tooltip.appendMarkdown(`**File:** ${thread.threadContext.filePath}\n\n`);
			const lineNumber =
				thread.threadContext.rightFileStart?.line ||
				thread.threadContext.rightFileEnd?.line;
			if (lineNumber) {
				tooltip.appendMarkdown(`**Line:** ${lineNumber}\n\n`);
			}
		}

		tooltip.appendMarkdown(
			`**Published:** ${thread.publishedDate.toLocaleString()}\n\n`,
		);
		tooltip.appendMarkdown(
			`**Last Updated:** ${thread.lastUpdatedDate.toLocaleString()}\n\n`,
		);

		if (thread.comments.length > 1) {
			tooltip.appendMarkdown(`**Replies:** ${thread.comments.length - 1}\n\n`);
		}

		return tooltip;
	}

	private createCommentTooltip(comment: PRComment): vscode.MarkdownString {
		const tooltip = new vscode.MarkdownString();
		tooltip.isTrusted = true;

		tooltip.appendMarkdown(`**${comment.author.displayName}**\n\n`);
		tooltip.appendMarkdown(`${comment.content}\n\n`);
		tooltip.appendMarkdown(`---\n\n`);
		tooltip.appendMarkdown(
			`**Published:** ${comment.publishedDate.toLocaleString()}\n\n`,
		);

		if (comment.lastUpdatedDate.getTime() !== comment.publishedDate.getTime()) {
			tooltip.appendMarkdown(
				`**Last Updated:** ${comment.lastUpdatedDate.toLocaleString()}\n\n`,
			);
		}

		return tooltip;
	}
}

class CommentTreeItem extends vscode.TreeItem {
	children?: CommentTreeItem[];
	thread?: PRThread;
	comment?: PRComment;
	sortDate?: Date;

	constructor(
		public readonly label: string,
		public readonly description: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public override readonly contextValue: string,
	) {
		super(label, collapsibleState);
		this.description = description;
	}
}
