import * as vscode from "vscode";
import type { PRComment, PRThread } from "../services/azureDevOpsClient";

export function formatTimeAgo(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) {
		return "just now";
	}
	if (diffMins < 60) {
		return `${diffMins}m ago`;
	}
	if (diffHours < 24) {
		return `${diffHours}h ago`;
	}
	if (diffDays < 7) {
		return `${diffDays}d ago`;
	}
	return date.toLocaleDateString();
}

export function getThreadStatusLabel(status: string | number | undefined | null): string {
	const statusMap: { [key: string]: string } = {
		"0": "Unknown",
		"1": "Active",
		"2": "Resolved",
		"3": "Won't Fix",
		"4": "Closed",
		"5": "By Design",
		"6": "Pending",
		unknown: "Unknown",
		active: "Active",
		fixed: "Resolved",
		wontfix: "Won't Fix",
		closed: "Closed",
		bydesign: "By Design",
		pending: "Pending",
	};

	if (status === undefined || status === null) {
		return "Not Set";
	}

	const statusKey = status.toString().toLowerCase();
	return statusMap[statusKey] || `Unknown (${status})`;
}

export function getThreadStatusIcon(statusLabel: string): string {
	switch (statusLabel.toLowerCase()) {
		case "active":
			return "💬";
		case "resolved":
		case "closed":
			return "✅";
		case "pending":
			return "⏱️";
		case "won't fix":
		case "by design":
			return "🚫";
		default:
			return "💬";
	}
}

export function cleanCommentContent(
	content: string,
	identityResolver?: Map<string, string>,
): string {
	const cleaned = content.replace(/@<([A-F0-9-]+)>/gi, (_match, guid) => {
		if (identityResolver) {
			const displayName = identityResolver.get(guid.toLowerCase());
			if (displayName) {
				return `@${displayName}`;
			}
		}
		return "@user";
	});
	return cleaned.trim();
}

export function formatCommentHeaderMarkdown(
	comment: PRComment,
	threadStatus?: string | number,
	includeStatus = false,
): string {
	const parts: string[] = [];

	parts.push(`**${comment.author.displayName}**`);

	parts.push(formatTimeAgo(comment.publishedDate));

	if (includeStatus && threadStatus !== undefined && threadStatus !== null) {
		const statusLabel = getThreadStatusLabel(threadStatus);
		if (
			statusLabel !== "Active" &&
			!statusLabel.startsWith("Unknown") &&
			!statusLabel.startsWith("Not Set")
		) {
			const icon = getThreadStatusIcon(statusLabel);
			parts.push(`${icon} ${statusLabel}`);
		}
	}

	if (comment.lastUpdatedDate.getTime() !== comment.publishedDate.getTime()) {
		parts.push("*(edited)*");
	}

	return parts.join(" • ");
}

export function formatCommentAsMarkdown(
	comment: PRComment,
	thread?: PRThread,
): vscode.MarkdownString {
	const parts: string[] = [];

	const threadStatus = thread?.status;
	const header = formatCommentHeaderMarkdown(comment, threadStatus, true);
	parts.push(header);
	parts.push(""); // Blank line

	const content = cleanCommentContent(comment.content || "[No content]");
	parts.push(content);

	if (thread?.threadContext?.filePath) {
		parts.push(""); // Blank line
		parts.push("---");

		const fileName =
			thread.threadContext.filePath.split("/").pop() || thread.threadContext.filePath;
		const lineNumber =
			thread.threadContext.rightFileStart?.line || thread.threadContext.rightFileEnd?.line;

		if (lineNumber) {
			parts.push(`📄 ${fileName}:${lineNumber}`);
		} else {
			parts.push(`📄 ${fileName}`);
		}
	}

	const markdown = new vscode.MarkdownString(parts.join("\n"));
	markdown.supportThemeIcons = true;
	markdown.isTrusted = true;
	markdown.supportHtml = false;

	return markdown;
}

export function formatRepliesAsMarkdown(comments: PRComment[]): vscode.MarkdownString | undefined {
	if (comments.length <= 1) {
		return undefined; // No replies
	}

	const replies = comments.slice(1); // Skip first comment
	const parts: string[] = [];

	parts.push("---");
	parts.push(`**${replies.length} ${replies.length === 1 ? "Reply" : "Replies"}**`);
	parts.push("");

	for (const reply of replies) {
		const replyHeader = formatCommentHeaderMarkdown(reply);
		const replyContent = cleanCommentContent(reply.content || "[No content]");

		parts.push(`> ${replyHeader}`);
		parts.push(`> ${replyContent}`);
		parts.push("");
	}

	const markdown = new vscode.MarkdownString(parts.join("\n"));
	markdown.supportThemeIcons = true;
	markdown.isTrusted = true;
	markdown.supportHtml = false;

	return markdown;
}
