import * as vscode from "vscode";
import type { PRComment } from "../services/azureDevOpsClient";
import { cleanCommentContent } from "../utils/commentFormatter";
import { processCommentContent } from "../utils/markdownProcessor";

export interface AuthorInfo {
	id: string;
	displayName: string;
	uniqueName: string;
	imageUrl?: string;
}

export abstract class CommentBase implements vscode.Comment {
	protected _body: string | vscode.MarkdownString;
	protected _mode: vscode.CommentMode = vscode.CommentMode.Preview;
	protected _contextValue?: string;
	protected identityResolver?: Map<string, string>;

	public author: vscode.CommentAuthorInformation;
	public timestamp?: Date;
	public label?: string;

	constructor(
		protected readonly rawContent: string,
		protected readonly authorInfo: AuthorInfo,
		protected readonly parent: vscode.CommentThread,
		protected readonly organizationUrl?: string,
		identityResolver?: Map<string, string>,
	) {
		this.author = {
			name: authorInfo.displayName,
			iconPath: authorInfo.imageUrl ? vscode.Uri.parse(authorInfo.imageUrl) : undefined,
		};
		this.identityResolver = identityResolver;
		this._body = this.formatBody(rawContent);
	}

	get body(): string | vscode.MarkdownString {
		return this._body;
	}

	set body(value: string | vscode.MarkdownString) {
		this._body = value;
	}

	get mode(): vscode.CommentMode {
		return this._mode;
	}

	set mode(value: vscode.CommentMode) {
		this._mode = value;
	}

	get contextValue(): string | undefined {
		return this._contextValue;
	}

	protected formatBody(content: string): vscode.MarkdownString {
		const cleaned = cleanCommentContent(content, this.identityResolver);
		return processCommentContent(cleaned, this.organizationUrl);
	}

	protected updateContext(canEdit: boolean, canDelete: boolean, hasSuggestion?: boolean): void {
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

		this._contextValue = contextValues.length > 0 ? contextValues.join(",") : undefined;
	}

	public setAuthorIcon(filePath: string): void {
		this.author = {
			...this.author,
			iconPath: vscode.Uri.file(filePath),
		};
	}
}

export class TemporaryComment extends CommentBase {
	private static nextId = 0;
	public readonly tempId: string;
	private originalBody: string;

	constructor(
		content: string,
		author: AuthorInfo,
		parent: vscode.CommentThread,
		organizationUrl?: string,
		identityResolver?: Map<string, string>,
	) {
		super(content, author, parent, organizationUrl, identityResolver);

		this.tempId = `temp-${TemporaryComment.nextId++}`;
		this.originalBody = content;
		this.timestamp = new Date();
		this.label = "Pending";
		this._mode = vscode.CommentMode.Preview;

		this._contextValue = "pending";
	}

	public getCancelEditBody(): string {
		return this.originalBody;
	}

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
			this.identityResolver,
		);

		if (this.author.iconPath) {
			realComment.author = {
				...realComment.author,
				iconPath: this.author.iconPath,
			};
		}

		return realComment;
	}

	override get body(): string | vscode.MarkdownString {
		const markdown = new vscode.MarkdownString();
		markdown.isTrusted = true;
		markdown.supportThemeIcons = true;

		markdown.appendMarkdown("_Pending..._\n\n");
		markdown.appendMarkdown(typeof this._body === "string" ? this._body : this._body.value);

		return markdown;
	}
}

export class AzDOComment extends CommentBase {
	public readonly commentId: number;
	public readonly threadId: number;
	private publishedDate: Date;
	private lastUpdatedDate: Date;
	private wasEdited: boolean = false;
	private editingOriginalContent?: string;

	constructor(
		private serverComment: PRComment,
		threadId: number,
		parent: vscode.CommentThread,
		organizationUrl?: string,
		private currentUserId?: string,
		identityResolver?: Map<string, string>,
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
			identityResolver,
		);

		this.commentId = serverComment.id;
		this.threadId = threadId;
		this.publishedDate = serverComment.publishedDate;
		this.lastUpdatedDate = serverComment.lastUpdatedDate;
		this.timestamp = this.publishedDate;

		this.wasEdited = this.lastUpdatedDate.getTime() !== this.publishedDate.getTime();
		this.updatePermissions();
		this.updateLabel();
	}

	public update(newServerComment: PRComment): boolean {
		// Check if content or metadata changed
		const contentChanged = this.serverComment.content !== newServerComment.content;
		const editTimeChanged =
			this.serverComment.lastUpdatedDate.getTime() !== newServerComment.lastUpdatedDate.getTime();

		if (!contentChanged && !editTimeChanged) {
			return false;
		}

		this.serverComment = newServerComment;
		this.lastUpdatedDate = newServerComment.lastUpdatedDate;
		this.wasEdited = this.lastUpdatedDate.getTime() !== this.publishedDate.getTime();

		if (contentChanged) {
			this._body = this.formatBody(newServerComment.content);
		}

		this.updateLabel();

		return true;
	}

	public getServerComment(): PRComment {
		return this.serverComment;
	}

	private hasSuggestion(): boolean {
		return /```suggestion/i.test(this.serverComment.content);
	}

	private updatePermissions(): void {
		const canEdit = !!this.currentUserId && this.serverComment.author.id === this.currentUserId;
		const canDelete = canEdit;
		const hasSuggestion = this.hasSuggestion();

		this.updateContext(canEdit, canDelete, hasSuggestion);

		if (this._mode === vscode.CommentMode.Editing && this._contextValue) {
			this._contextValue = `${this._contextValue},editing`;
		}
	}

	private updateLabel(): void {
		const parts: string[] = [];

		if (this.wasEdited) {
			parts.push("Edited");
		}

		this.label = parts.length > 0 ? parts.join(" • ") : undefined;
	}

	public getEditableContent(): string {
		return this.serverComment.content;
	}

	public applyEdit(newContent: string): void {
		this.serverComment.content = newContent;
		this.lastUpdatedDate = new Date();
		this.wasEdited = true;
		this._body = this.formatBody(newContent);
		this.updateLabel();
	}

	public getThread(): vscode.CommentThread {
		return this.parent;
	}

	public startEdit(): void {
		this.editingOriginalContent = this.getEditableContent();
		this._mode = vscode.CommentMode.Editing;
		this._body = this.editingOriginalContent;
		this.updatePermissions();
	}

	public cancelEdit(): void {
		if (this.editingOriginalContent !== undefined) {
			this._body = this.formatBody(this.editingOriginalContent);
		}
		this._mode = vscode.CommentMode.Preview;
		this.editingOriginalContent = undefined;
		this.updatePermissions();
	}

	public getEditedContent(): string {
		return typeof this._body === "string" ? this._body : this._body.value;
	}

	public extractSuggestion(): { content: string; originalLine: number } | null {
		const content = this.serverComment.content;
		const match = content.match(/```suggestion\s*\n([\s\S]*?)```/i);
		if (!match) {
			return null;
		}

		// Get the line number from the parent thread
		const lineNumber = this.parent.range?.start.line ?? -1;
		if (lineNumber < 0) {
			return null;
		}

		return {
			content: match[1].trimEnd(), // Keep leading whitespace for indentation
			originalLine: lineNumber + 1, // Convert to 1-based
		};
	}
}
