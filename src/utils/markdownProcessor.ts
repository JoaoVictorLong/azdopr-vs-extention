import * as vscode from "vscode";

/**
 * Process comment content into rich MarkdownString with enhanced formatting
 * @param content The raw comment content
 * @param organizationUrl Optional Azure DevOps organization URL for linking
 * @returns Enhanced MarkdownString
 */
export function processCommentContent(
	content: string,
	organizationUrl?: string,
): vscode.MarkdownString {
	// Process the content
	let processed = content;

	// 1. Convert Azure DevOps work item references (#123) to links
	if (organizationUrl) {
		processed = linkifyWorkItems(processed, organizationUrl);
	}

	// 2. Enhance @mentions (if they exist in the format @<name>)
	processed = enhanceMentions(processed);

	// Create markdown string with enhancements
	const markdown = new vscode.MarkdownString(processed);
	markdown.supportThemeIcons = true; // Enable theme icons
	markdown.isTrusted = true; // Enable command links and HTML (if needed)
	markdown.supportHtml = false; // Security: disable raw HTML by default

	return markdown;
}

/**
 * Enhance @mentions in comments
 * @param content The comment content
 * @returns Content with enhanced mentions
 */
function enhanceMentions(content: string): string {
	// Azure DevOps mentions come in format @<DisplayName>
	// We can make them bold for better visibility
	// Match @username or @First Last (second word only if it starts with uppercase)
	// This distinguishes "@John Doe" from "@john please"
	return content.replace(/@(\w+(?:\s+[A-Z]\w*)?)/g, "**@$1**");
}

/**
 * Convert work item references (#123) to clickable links
 * @param content The comment content
 * @param organizationUrl The Azure DevOps organization URL
 * @returns Content with work item links
 */
function linkifyWorkItems(content: string, organizationUrl: string): string {
	// Convert #123 to work item links
	// Azure DevOps work items: https://dev.azure.com/{org}/{project}/_workitems/edit/{id}
	// Note: We don't have project context here, so we link to the org-level work item
	return content.replace(
		/#(\d+)(?!\))/g, // Match #123 but not if it's already in a markdown link
		`[#$1](${organizationUrl}/_workitems/edit/$1)`,
	);
}
