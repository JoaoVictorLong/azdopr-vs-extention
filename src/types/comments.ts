import * as vscode from "vscode";
import type { PRComment } from "../services/azureDevOpsClient";
import {
	cleanCommentContent,
	formatTimeAgo,
} from "../utils/commentFormatter";
import { processCommentContent } from "../utils/markdownProcessor";

/**
 * Author information for comments
 */
export interface AuthorInfo {
	id: string;
	displayName: string;
	uniqueName: string;
	imageUrl?: string;
}

/**
 * Base abstract class for all comment types
 * Implements vscode.Comment interface with shared functionality
 * Inspired by GitHub PR extension's CommentBase class
 */
export abstract class CommentBase implements vscode.Comment {
	protected _body: string | vscode.MarkdownString;
	protected _mode: vscode.CommentMode = vscode.CommentMode.Preview;
	protected _contextValue?: string;

	public author: vscode.CommentAuthorInformation;
	public timestamp?: Date;
	public label?: string;

	constructor(
		protected readonly rawContent: string,
		protected readonly authorInfo: AuthorInfo,
		protected readonly parent: vscode.CommentThread,
		protected readonly organizationUrl?: string,
	) {
		this.author = {
			name: authorInfo.displayName,
			iconPath: authorInfo.imageUrl
				? vscode.Uri.parse(authorInfo.imageUrl)
				: undefined,
		};
		this._body = this.formatBody(rawContent);
	}

	/**
	 * Get the comment body
	 * Subclasses can override to provide different formatting
	 */
	get body(): string | vscode.MarkdownString {
		return this._body;
	}

	/**
	 * Set the comment body
	 * Typically used during editing
	 */
	set body(value: string | vscode.MarkdownString) {
		this._body = value;
	}

	/**
	 * Get the comment mode (Preview or Editing)
	 */
	get mode(): vscode.CommentMode {
		return this._mode;
	}

	/**
	 * Set the comment mode
	 */
	set mode(value: vscode.CommentMode) {
		this._mode = value;
	}

	/**
	 * Get the context value for conditional UI
	 */
	get contextValue(): string | undefined {
		return this._contextValue;
	}

	/**
	 * Format comment body as MarkdownString
	 */
	protected formatBody(content: string): vscode.MarkdownString {
		const cleaned = cleanCommentContent(content);
		return processCommentContent(cleaned, this.organizationUrl);
	}

	/**
	 * Update context values based on permissions
	 */
	protected updateContext(
		canEdit: boolean,
		canDelete: boolean,
		hasSuggestion?: boolean,
	): void {
		const contextValues: string[] = [];

		if (canEdit) {
			contextValues.push("canEdit");
		}
		if (canDelete) {
			contextValues.push("canDelete");
		}
		if (hasSuggestion) {
			contextValues.push("hasSuggestion");
		}

		this._contextValue =
			contextValues.length > 0 ? contextValues.join(",") : undefined;
	}

	/**
	 * Set author icon from data URI
	 */
	public setAuthorIcon(dataUri: string): void {
		this.author = {
			...this.author,
			iconPath: vscode.Uri.parse(dataUri),
		};
	}
}

/**
 * Temporary comment shown during async operations
 * Displays "Pending" state until server confirms
 * Can be converted to AzDOComment when server responds
 */
export class TemporaryComment extends CommentBase {
	private static nextId = 0;
	public readonly tempId: string;
	private originalBody: string;

	constructor(
		content: string,
		author: AuthorInfo,
		parent: vscode.CommentThread,
		organizationUrl?: string,
	) {
		super(content, author, parent, organizationUrl);

		this.tempId = `temp-${TemporaryComment.nextId++}`;
		this.originalBody = content;
		this.timestamp = new Date();
		this.label = "Pending";
		this._mode = vscode.CommentMode.Preview;

		// Temporary comments cannot be edited/deleted until confirmed
		this._contextValue = "pending";
	}

	/**
	 * Get the original body before any edits
	 */
	public getCancelEditBody(): string {
		return this.originalBody;
	}

	/**
	 * Convert this temporary comment to a real AzDOComment
	 * Called when server confirms the comment creation
	 */
	public toRealComment(
		serverComment: PRComment,
		threadId: number,
		currentUserId?: string,
	): AzDOComment {
		const realComment = new AzDOComment(
			serverComment,
			threadId,
			this.parent,
			this.organizationUrl,
			currentUserId,
		);

		// Preserve any icon that was set
		if (this.author.iconPath) {
			realComment.author = {
				...realComment.author,
				iconPath: this.author.iconPath,
			};
		}

		return realComment;
	}

	/**
	 * Override body getter to show pending indicator
	 */
	override get body(): string | vscode.MarkdownString {
		const markdown = new vscode.MarkdownString();
		markdown.isTrusted = true;
		markdown.supportThemeIcons = true;

		markdown.appendMarkdown("_Pending..._\n\n");
		markdown.appendMarkdown(
			typeof this._body === "string"
				? this._body
				: this._body.value,
		);

		return markdown;
	}
}

/**
 * Real comment from Azure DevOps server
 * Can be updated in place without recreation
 */
export class AzDOComment extends CommentBase {
	public readonly commentId: number;
	public readonly threadId: number;
	private publishedDate: Date;
	private lastUpdatedDate: Date;
	private wasEdited: boolean = false;

	constructor(
		private serverComment: PRComment,
		threadId: number,
		parent: vscode.CommentThread,
		organizationUrl?: string,
		private currentUserId?: string,
	) {
		super(
			serverComment.content,
			{
				id: serverComment.author.id,
				displayName: serverComment.author.displayName,
				uniqueName: serverComment.author.uniqueName,
				imageUrl: serverComment.author.imageUrl,
			},
			parent,
			organizationUrl,
		);

		this.commentId = serverComment.id;
		this.threadId = threadId;
		this.publishedDate = serverComment.publishedDate;
		this.lastUpdatedDate = serverComment.lastUpdatedDate;
		this.timestamp = this.publishedDate;

		// Check if edited
		this.wasEdited =
			this.lastUpdatedDate.getTime() !== this.publishedDate.getTime();

		// Update permissions
		this.updatePermissions();

		// Update label
		this.updateLabel();
	}

	/**
	 * Update this comment with new data from server
	 * Returns true if the comment was actually changed
	 */
	public update(newServerComment: PRComment): boolean {
		// Check if content or metadata changed
		const contentChanged =
			this.serverComment.content !== newServerComment.content;
		const editTimeChanged =
			this.serverComment.lastUpdatedDate.getTime() !==
			newServerComment.lastUpdatedDate.getTime();

		if (!contentChanged && !editTimeChanged) {
			return false; // No changes
		}

		// Update stored comment
		this.serverComment = newServerComment;
		this.lastUpdatedDate = newServerComment.lastUpdatedDate;
		this.wasEdited =
			this.lastUpdatedDate.getTime() !== this.publishedDate.getTime();

		// Update body if content changed
		if (contentChanged) {
			this._body = this.formatBody(newServerComment.content);
		}

		// Update label
		this.updateLabel();

		return true;
	}

	/**
	 * Get the raw server comment data
	 */
	public getServerComment(): PRComment {
		return this.serverComment;
	}

	/**
	 * Check if this comment has suggestion code
	 */
	private hasSuggestion(): boolean {
		return /```suggestion/i.test(this.serverComment.content);
	}

	/**
	 * Update permissions based on current user
	 */
	private updatePermissions(): void {
		const canEdit =
			!!this.currentUserId &&
			this.serverComment.author.id === this.currentUserId;
		const canDelete = canEdit;
		const hasSuggestion = this.hasSuggestion();

		this.updateContext(canEdit, canDelete, hasSuggestion);
	}

	/**
	 * Update label with metadata
	 */
	private updateLabel(): void {
		const parts: string[] = [];

		// Time ago
		parts.push(formatTimeAgo(this.publishedDate));

		// Edited indicator
		if (this.wasEdited) {
			parts.push("Edited");
		}

		this.label = parts.length > 0 ? parts.join(" • ") : undefined;
	}

	/**
	 * Get content for editing
	 * Returns raw content without markdown formatting
	 */
	public getEditableContent(): string {
		return this.serverComment.content;
	}

	/**
	 * Update after a successful edit
	 */
	public applyEdit(newContent: string): void {
		this.serverComment.content = newContent;
		this.lastUpdatedDate = new Date();
		this.wasEdited = true;
		this._body = this.formatBody(newContent);
		this.updateLabel();
	}
}
