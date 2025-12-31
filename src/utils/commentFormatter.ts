import * as vscode from "vscode";
import type { PRComment, PRThread } from "../services/azureDevOpsClient";

/**
 * Unified comment formatting utilities
 * Ensures consistent comment display across inline diffs, tree view, and webview
 */

/**
 * Format time ago (e.g., "2h ago", "3d ago")
 */
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

/**
 * Get human-readable thread status label
 */
export function getThreadStatusLabel(status: string | number | undefined | null): string {
	const statusMap: { [key: string]: string } = {
		// Numeric values
		"0": "Unknown",
		"1": "Active",
		"2": "Resolved",
		"3": "Won't Fix",
		"4": "Closed",
		"5": "By Design",
		"6": "Pending",
		// Text values (case-insensitive)
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

/**
 * Get status icon for a thread
 */
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

/**
 * Clean comment content by removing GUID mentions
 */
export function cleanCommentContent(content: string): string {
	// Remove GUID mentions like @<5B8B71B7-3EB7-6574-B377-A695965DBDA8>
	const cleaned = content.replace(/@<[A-F0-9-]+>/gi, "@user");
	return cleaned.trim();
}

/**
 * Format a comment header as markdown
 * Used for inline diff comments
 */
export function formatCommentHeaderMarkdown(
	comment: PRComment,
	threadStatus?: string | number,
	includeStatus = false,
): string {
	const parts: string[] = [];

	// Author
	parts.push(`**${comment.author.displayName}**`);

	// Time
	parts.push(formatTimeAgo(comment.publishedDate));

	// Status (if requested and meaningful)
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

	// Edited indicator
	if (comment.lastUpdatedDate.getTime() !== comment.publishedDate.getTime()) {
		parts.push("*(edited)*");
	}

	return parts.join(" • ");
}

/**
 * Format a comment header as HTML
 * Used for webview comments
 */
export function formatCommentHeaderHtml(
	comment: PRComment,
	threadStatus?: string | number,
	includeStatus = false,
	escapeHtml: (text: string) => string = (t) => t,
): string {
	const parts: string[] = [];

	// Author
	parts.push(`<span class="comment-author">${escapeHtml(comment.author.displayName)}</span>`);

	// Time
	parts.push(`<span class="comment-time">${formatTimeAgo(comment.publishedDate)}</span>`);

	// Status badge (if requested and meaningful)
	if (includeStatus && threadStatus !== undefined && threadStatus !== null) {
		const statusLabel = getThreadStatusLabel(threadStatus);
		if (
			statusLabel !== "Active" &&
			!statusLabel.startsWith("Unknown") &&
			!statusLabel.startsWith("Not Set")
		) {
			const statusClass = getStatusBadgeClass(threadStatus);
			parts.push(
				`<span class="comment-status-badge ${statusClass}">${escapeHtml(statusLabel)}</span>`,
			);
		}
	}

	// Edited indicator
	if (comment.lastUpdatedDate.getTime() !== comment.publishedDate.getTime()) {
		parts.push('<span class="comment-edited">(edited)</span>');
	}

	return parts.join(" ");
}

/**
 * Get CSS class for status badge
 */
function getStatusBadgeClass(status: string | number | undefined | null): string {
	const statusNum = typeof status === "string" ? Number.parseInt(status, 10) : status;

	if (statusNum === 2 || statusNum === 4) {
		return "status-badge-resolved";
	}
	if (statusNum === 3 || statusNum === 5) {
		return "status-badge-wontfix";
	}
	if (statusNum === 6) {
		return "status-badge-pending";
	}
	return "status-badge-unknown";
}

/**
 * Format a complete comment as markdown for inline display
 * This creates a rich, consistent markdown display
 */
export function formatCommentAsMarkdown(
	comment: PRComment,
	thread?: PRThread,
	_organizationUrl?: string,
): vscode.MarkdownString {
	const parts: string[] = [];

	// Header with metadata
	const threadStatus = thread?.status;
	const header = formatCommentHeaderMarkdown(comment, threadStatus, true);
	parts.push(header);
	parts.push(""); // Blank line

	// Content (cleaned)
	const content = cleanCommentContent(comment.content || "[No content]");
	parts.push(content);

	// File and line context (if available)
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

/**
 * Format reply comments as markdown
 */
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
