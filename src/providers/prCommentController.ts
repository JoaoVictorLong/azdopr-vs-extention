import * as vscode from "vscode";
import { PRContextManager } from "../services/prContextManager";
import type {
	AzureDevOpsClient,
	PRThread,
} from "../services/azureDevOpsClient";

/**
 * Metadata stored for each comment thread
 */
interface CommentThreadMetadata {
	/** The Azure DevOps PR thread ID */
	prThreadId?: number;
}

/**
 * Controller for displaying and managing PR comments inline in diff views
 * Uses VS Code's native Comment API to show existing comments and allow adding new ones
 */
export class PRCommentController {
	private readonly commentController: vscode.CommentController;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly commentThreads: Map<string, vscode.CommentThread> =
		new Map();
	/** Metadata storage for comment threads, keyed by thread key */
	private readonly threadMetadata: Map<string, CommentThreadMetadata> =
		new Map();
	/** Track documents currently being loaded to prevent duplicate loads */
	private readonly loadingDocuments: Set<string> = new Set();

	constructor(private readonly azureDevOpsClient: AzureDevOpsClient) {
		console.log("[PRCommentController] Initializing PR Comment Controller");

		// Create the comment controller
		this.commentController = vscode.comments.createCommentController(
			"azdo-pr-comments",
			"Azure DevOps PR Viewer Comments",
		);

		// Configure comment controller options
		this.commentController.options = {
			prompt: "Add a comment",
			placeHolder: "Write your comment here...",
		};

		this.setupCommentingRangeProvider();

		// Register command for accepting comment input (submit button)
		this.disposables.push(
			vscode.commands.registerCommand(
				"azdo-pr-comments.acceptInput",
				async (reply: vscode.CommentReply) => {
					await this.handleCommentSubmit(reply);
				},
			),
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				console.log(
					`[PRCommentController] Active editor changed: ${editor ? editor.document.uri.toString() : "none"}`,
				);
				if (editor) {
					this.loadCommentsForDocument(editor.document);
				}
			}),
		);
	}

	/**
	 * Initialize the comment controller and load comments for the current editor.
	 * This should be called after construction to avoid async operations in the constructor.
	 */
	public async initialize(): Promise<void> {
		// Load comments for the current editor
		if (vscode.window.activeTextEditor) {
			console.log(
				`[PRCommentController] Loading comments for current editor: ${vscode.window.activeTextEditor.document.uri.toString()}`,
			);
			await this.loadCommentsForDocument(
				vscode.window.activeTextEditor.document,
			);
		} else {
			console.log("[PRCommentController] No active editor on initialization");
		}
	}

	/**
	 * Setup the commenting range provider for the comment controller
	 */
	private setupCommentingRangeProvider(): void {
		this.commentController.commentingRangeProvider = {
			provideCommentingRanges: (
				document: vscode.TextDocument,
			): vscode.Range[] | undefined => {
				// Allow commenting on any line in PR diff documents
				if (document.uri.scheme === "azdo-pr") {
					const lineCount = document.lineCount;
					return [new vscode.Range(0, 0, lineCount - 1, 0)];
				}
				return undefined;
			},
		};
	}

	/**
	 * Load and display comments for a document
	 */
	public async loadCommentsForDocument(
		document: vscode.TextDocument,
	): Promise<void> {
		const uriString = document.uri.toString();
		console.log(
			`[PRCommentController] loadCommentsForDocument called for: ${uriString} (scheme: ${document.uri.scheme})`,
		);

		// Only process PR diff documents
		if (document.uri.scheme !== "azdo-pr") {
			console.log(
				`[PRCommentController] Skipping document - wrong scheme: ${document.uri.scheme}`,
			);
			return;
		}

		// Prevent duplicate loads for the same document
		if (this.loadingDocuments.has(uriString)) {
			console.log(
				`[PRCommentController] Already loading comments for: ${uriString}`,
			);
			return;
		}
		this.loadingDocuments.add(uriString);

		const contextManager = PRContextManager.getInstance();
		const fileContext = contextManager.getPRFileContext(document.uri);

		if (!fileContext) {
			console.log(
				`[PRCommentController] No file context found for: ${document.uri.toString()}`,
			);
			return;
		}

		console.log(
			`[PRCommentController] File context found - PR #${fileContext.pullRequest.pullRequestId}, file: ${fileContext.filePath}, side: ${fileContext.side}`,
		);

		// Clean up existing comment threads for this document
		this.clearCommentsForDocument(document.uri);

		try {
			// Fetch PR threads
			const threads = await this.azureDevOpsClient.getPullRequestThreads(
				fileContext.pullRequest.repository.project.id,
				fileContext.pullRequest.repository.id,
				fileContext.pullRequest.pullRequestId,
			);

			console.log(
				`Fetched ${threads.length} total threads for PR #${fileContext.pullRequest.pullRequestId}`,
			);

			// Filter threads for this file
			const fileThreads = threads.filter((thread) => {
				if (!thread.threadContext?.filePath) {
					return false;
				}
				// Normalize file paths for comparison
				const threadPath = this.normalizePath(thread.threadContext.filePath);
				const currentPath = this.normalizePath(fileContext.filePath);
				return threadPath === currentPath;
			});

			console.log(
				`Found ${fileThreads.length} threads for file: ${fileContext.filePath} (side: ${fileContext.side})`,
			);

			// Create comment threads for this document
			let createdCount = 0;
			for (const thread of fileThreads) {
				this.createCommentThread(document, thread, fileContext.side);
				createdCount++;
			}

			console.log(
				`Created ${createdCount} comment threads in the editor for ${fileContext.filePath}`,
			);
		} catch (error) {
			console.error("Failed to load comments for document:", error);
		} finally {
			// Always remove from loading set when done
			this.loadingDocuments.delete(uriString);
		}
	}

	/**
	 * Clear all comment threads for a specific document
	 */
	private clearCommentsForDocument(uri: vscode.Uri): void {
		const uriString = uri.toString();
		const threadsToRemove: string[] = [];

		for (const [key, thread] of this.commentThreads) {
			if (key.startsWith(uriString)) {
				thread.dispose();
				threadsToRemove.push(key);
			}
		}

		for (const key of threadsToRemove) {
			this.commentThreads.delete(key);
			this.threadMetadata.delete(key);
		}
	}

	/**
	 * Normalize file path for comparison (remove leading slash, normalize separators)
	 */
	private normalizePath(path: string): string {
		return path.replace(/^\/+/, "").replace(/\\/g, "/").toLowerCase();
	}

	/**
	 * Create a VS Code comment thread from a PR thread
	 */
	private createCommentThread(
		document: vscode.TextDocument,
		thread: PRThread,
		side: "base" | "modified",
	): void {
		// Determine which line to show the comment on based on the side
		let lineNumber: number | undefined;

		if (side === "modified") {
			// For the modified side, use the right file position
			lineNumber = thread.threadContext?.rightFileStart?.line;
		} else {
			// For the base side, use the left file position
			lineNumber = thread.threadContext?.leftFileStart?.line;
		}

		// If no line number is available, skip this thread
		if (!lineNumber || lineNumber < 1) {
			console.log(
				`Skipping thread ${thread.id}: No valid line number for ${side} side (lineNumber=${lineNumber})`,
			);
			return;
		}

		// Convert to 0-based line number
		const zeroBasedLine = lineNumber - 1;

		// Ensure line number is within document bounds
		if (zeroBasedLine >= document.lineCount) {
			console.log(
				`Skipping thread ${thread.id}: Line ${lineNumber} is out of bounds (document has ${document.lineCount} lines)`,
			);
			return;
		}

		// Create range for the comment
		const range = new vscode.Range(zeroBasedLine, 0, zeroBasedLine, 0);

		// Create comment objects that conform to vscode.Comment interface
		const comments: vscode.Comment[] = thread.comments.map((comment) => {
			const vscodeComment: vscode.Comment = {
				body: new vscode.MarkdownString(comment.content),
				mode: vscode.CommentMode.Preview,
				author: {
					name: comment.author.displayName,
					iconPath: comment.author.imageUrl
						? vscode.Uri.parse(comment.author.imageUrl)
						: undefined,
				},
			};
			return vscodeComment;
		});

		// Create the comment thread
		const commentThread = this.commentController.createCommentThread(
			document.uri,
			range,
			comments,
		);

		// Set thread properties
		// Only show label for non-active threads (resolved, closed, etc.)
		const statusNum = typeof thread.status === 'string' ? parseInt(thread.status, 10) : thread.status;
		if (statusNum !== undefined && statusNum !== null && statusNum !== 1 && statusNum !== 0) {
			commentThread.label = this.getThreadStatusLabel(thread.status);
		}
		commentThread.canReply = true;
		commentThread.collapsibleState =
			vscode.CommentThreadCollapsibleState.Expanded;

		// Track this comment thread for cleanup
		const threadKey = `${document.uri.toString()}#${thread.id}`;
		this.commentThreads.set(threadKey, commentThread);

		// Store thread metadata for future operations
		this.threadMetadata.set(threadKey, { prThreadId: thread.id });

		console.log(
			`Created comment thread ${thread.id} at line ${lineNumber} with ${comments.length} comment(s)`,
		);
	}

	/**
	 * Get the metadata for a comment thread by searching through stored threads
	 */
	private getThreadMetadata(
		thread: vscode.CommentThread,
	): CommentThreadMetadata | undefined {
		// Search for this thread in our stored threads
		for (const [key, storedThread] of this.commentThreads) {
			if (storedThread === thread) {
				return this.threadMetadata.get(key);
			}
		}
		return undefined;
	}

	/**
	 * Handle comment submission (both new threads and replies)
	 */
	private async handleCommentSubmit(reply: vscode.CommentReply): Promise<void> {
		try {
			const commentText = reply.text.trim();
			if (!commentText) {
				vscode.window.showWarningMessage("Comment cannot be empty");
				return;
			}

			// Get PR context from the document
			const contextManager = PRContextManager.getInstance();
			const fileContext = contextManager.getPRFileContext(reply.thread.uri);

			if (!fileContext) {
				vscode.window.showErrorMessage("No PR context found for this file");
				return;
			}

			const pr = fileContext.pullRequest;
			const metadata = this.getThreadMetadata(reply.thread);
			const prThreadId = metadata?.prThreadId;

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: prThreadId ? "Adding reply..." : "Creating comment...",
					cancellable: false,
				},
				async (progress) => {
					progress.report({ increment: 0 });

					if (prThreadId) {
						// Reply to existing thread
						await this.azureDevOpsClient.replyToPRThread(
							pr.repository.project.id,
							pr.repository.id,
							pr.pullRequestId,
							prThreadId,
							commentText,
						);
					} else {
						// Create new thread
						if (!reply.thread.range) {
							throw new Error("Cannot create new thread without a range");
						}
						const lineNumber = reply.thread.range.start.line + 1;
						await this.azureDevOpsClient.createPRThread(
							pr.repository.project.id,
							pr.repository.id,
							pr.pullRequestId,
							fileContext.filePath,
							lineNumber,
							commentText,
							fileContext.side,
						);
					}

					progress.report({ increment: 100 });
				},
			);

			// Find the document for the thread URI
			const document = vscode.workspace.textDocuments.find(
				(doc) => doc.uri.toString() === reply.thread.uri.toString(),
			);

			// Refresh comments to show the new comment
			if (document) {
				await this.loadCommentsForDocument(document);
			}

			vscode.window.showInformationMessage(
				prThreadId ? "Reply added successfully" : "Comment added successfully",
			);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			vscode.window.showErrorMessage(`Failed to add comment: ${errorMessage}`);
			console.error("Error adding comment:", error);
		}
	}

	/**
	 * Get human-readable label for thread status
	 */
	private getThreadStatusLabel(
		status: string | number | undefined | null,
	): string {
		const statusMap: { [key: string]: string } = {
			"0": "Unknown",
			"1": "Active",
			"2": "Resolved",
			"3": "Won't Fix",
			"4": "Closed",
			"5": "By Design",
			"6": "Pending",
		};
		return status !== undefined && status !== null
			? statusMap[status.toString()] || "Unknown"
			: "Unknown";
	}

	/**
	 * Refresh comments for all open PR diff documents
	 */
	public async refresh(): Promise<void> {
		// Dispose all existing comment threads
		for (const [, thread] of this.commentThreads) {
			thread.dispose();
		}
		this.commentThreads.clear();
		this.threadMetadata.clear();

		// Reload comments for all visible editors
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.scheme === "azdo-pr") {
				await this.loadCommentsForDocument(editor.document);
			}
		}
	}

	/**
	 * Dispose of resources
	 */
	public dispose(): void {
		// Dispose all comment threads
		for (const [, thread] of this.commentThreads) {
			thread.dispose();
		}
		this.commentThreads.clear();
		this.threadMetadata.clear();

		// Dispose the comment controller
		this.commentController.dispose();

		// Dispose other resources
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
