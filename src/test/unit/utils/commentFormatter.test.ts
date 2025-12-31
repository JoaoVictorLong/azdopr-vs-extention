import * as assert from "node:assert";
import { setup, suite, teardown, test } from "mocha";
import * as sinon from "sinon";
import {
	cleanCommentContent,
	formatCommentHeaderMarkdown,
	formatTimeAgo,
	getThreadStatusIcon,
	getThreadStatusLabel,
} from "../../../utils/commentFormatter";
import { createMockComment } from "../../fixtures";

suite("commentFormatter", () => {
	suite("formatTimeAgo", () => {
		let clock: sinon.SinonFakeTimers;

		setup(() => {
			// Fix time to a known value for consistent testing
			clock = sinon.useFakeTimers(new Date("2024-01-15T12:00:00Z").getTime());
		});

		teardown(() => {
			clock.restore();
		});

		test("should return 'just now' for times less than 1 minute ago", () => {
			const date = new Date("2024-01-15T11:59:30Z"); // 30 seconds ago
			assert.strictEqual(formatTimeAgo(date), "just now");
		});

		test("should return 'just now' for current time", () => {
			const date = new Date("2024-01-15T12:00:00Z"); // exactly now
			assert.strictEqual(formatTimeAgo(date), "just now");
		});

		test("should return minutes for times less than 1 hour ago", () => {
			const date1 = new Date("2024-01-15T11:59:00Z"); // 1 minute ago
			assert.strictEqual(formatTimeAgo(date1), "1m ago");

			const date2 = new Date("2024-01-15T11:45:00Z"); // 15 minutes ago
			assert.strictEqual(formatTimeAgo(date2), "15m ago");

			const date3 = new Date("2024-01-15T11:01:00Z"); // 59 minutes ago
			assert.strictEqual(formatTimeAgo(date3), "59m ago");
		});

		test("should return hours for times less than 24 hours ago", () => {
			const date1 = new Date("2024-01-15T11:00:00Z"); // 1 hour ago
			assert.strictEqual(formatTimeAgo(date1), "1h ago");

			const date2 = new Date("2024-01-15T06:00:00Z"); // 6 hours ago
			assert.strictEqual(formatTimeAgo(date2), "6h ago");

			const date3 = new Date("2024-01-14T13:00:00Z"); // 23 hours ago
			assert.strictEqual(formatTimeAgo(date3), "23h ago");
		});

		test("should return days for times less than 7 days ago", () => {
			const date1 = new Date("2024-01-14T12:00:00Z"); // 1 day ago
			assert.strictEqual(formatTimeAgo(date1), "1d ago");

			const date2 = new Date("2024-01-12T12:00:00Z"); // 3 days ago
			assert.strictEqual(formatTimeAgo(date2), "3d ago");

			const date3 = new Date("2024-01-09T12:00:00Z"); // 6 days ago
			assert.strictEqual(formatTimeAgo(date3), "6d ago");
		});

		test("should return localized date for times 7+ days ago", () => {
			const date = new Date("2024-01-01T12:00:00Z"); // 14 days ago
			const result = formatTimeAgo(date);
			// Result will be locale-specific, just verify it's not a relative time
			assert.ok(!result.includes("ago"));
			assert.ok(result.length > 0);
		});

		test("should handle edge case at 60 minutes boundary", () => {
			const date = new Date("2024-01-15T11:00:00Z"); // exactly 60 minutes ago
			assert.strictEqual(formatTimeAgo(date), "1h ago");
		});

		test("should handle edge case at 24 hours boundary", () => {
			const date = new Date("2024-01-14T12:00:00Z"); // exactly 24 hours ago
			assert.strictEqual(formatTimeAgo(date), "1d ago");
		});

		test("should handle edge case at 7 days boundary", () => {
			const date = new Date("2024-01-08T12:00:00Z"); // exactly 7 days ago
			const result = formatTimeAgo(date);
			assert.ok(!result.includes("ago")); // Should be a date string
		});
	});

	suite("getThreadStatusLabel", () => {
		test("should return 'Not Set' for undefined", () => {
			assert.strictEqual(getThreadStatusLabel(undefined), "Not Set");
		});

		test("should return 'Not Set' for null", () => {
			assert.strictEqual(getThreadStatusLabel(null), "Not Set");
		});

		test("should map numeric status 0 to 'Unknown'", () => {
			assert.strictEqual(getThreadStatusLabel(0), "Unknown");
			assert.strictEqual(getThreadStatusLabel("0"), "Unknown");
		});

		test("should map numeric status 1 to 'Active'", () => {
			assert.strictEqual(getThreadStatusLabel(1), "Active");
			assert.strictEqual(getThreadStatusLabel("1"), "Active");
		});

		test("should map numeric status 2 to 'Resolved'", () => {
			assert.strictEqual(getThreadStatusLabel(2), "Resolved");
			assert.strictEqual(getThreadStatusLabel("2"), "Resolved");
		});

		test("should map numeric status 3 to 'Won't Fix'", () => {
			assert.strictEqual(getThreadStatusLabel(3), "Won't Fix");
			assert.strictEqual(getThreadStatusLabel("3"), "Won't Fix");
		});

		test("should map numeric status 4 to 'Closed'", () => {
			assert.strictEqual(getThreadStatusLabel(4), "Closed");
			assert.strictEqual(getThreadStatusLabel("4"), "Closed");
		});

		test("should map numeric status 5 to 'By Design'", () => {
			assert.strictEqual(getThreadStatusLabel(5), "By Design");
			assert.strictEqual(getThreadStatusLabel("5"), "By Design");
		});

		test("should map numeric status 6 to 'Pending'", () => {
			assert.strictEqual(getThreadStatusLabel(6), "Pending");
			assert.strictEqual(getThreadStatusLabel("6"), "Pending");
		});

		test("should map text status 'active' to 'Active' (case insensitive)", () => {
			assert.strictEqual(getThreadStatusLabel("active"), "Active");
			assert.strictEqual(getThreadStatusLabel("Active"), "Active");
			assert.strictEqual(getThreadStatusLabel("ACTIVE"), "Active");
		});

		test("should map text status 'fixed' to 'Resolved'", () => {
			assert.strictEqual(getThreadStatusLabel("fixed"), "Resolved");
			assert.strictEqual(getThreadStatusLabel("Fixed"), "Resolved");
		});

		test("should map text status 'wontfix' to 'Won't Fix'", () => {
			assert.strictEqual(getThreadStatusLabel("wontfix"), "Won't Fix");
			assert.strictEqual(getThreadStatusLabel("WontFix"), "Won't Fix");
		});

		test("should map text status 'closed' to 'Closed'", () => {
			assert.strictEqual(getThreadStatusLabel("closed"), "Closed");
		});

		test("should map text status 'bydesign' to 'By Design'", () => {
			assert.strictEqual(getThreadStatusLabel("bydesign"), "By Design");
		});

		test("should map text status 'pending' to 'Pending'", () => {
			assert.strictEqual(getThreadStatusLabel("pending"), "Pending");
		});

		test("should map text status 'unknown' to 'Unknown'", () => {
			assert.strictEqual(getThreadStatusLabel("unknown"), "Unknown");
		});

		test("should return 'Unknown (value)' for unmapped status", () => {
			assert.strictEqual(getThreadStatusLabel("custom"), "Unknown (custom)");
			assert.strictEqual(getThreadStatusLabel(999), "Unknown (999)");
		});
	});

	suite("getThreadStatusIcon", () => {
		test("should return 💬 for 'Active'", () => {
			assert.strictEqual(getThreadStatusIcon("Active"), "💬");
			assert.strictEqual(getThreadStatusIcon("active"), "💬");
		});

		test("should return ✅ for 'Resolved'", () => {
			assert.strictEqual(getThreadStatusIcon("Resolved"), "✅");
			assert.strictEqual(getThreadStatusIcon("resolved"), "✅");
		});

		test("should return ✅ for 'Closed'", () => {
			assert.strictEqual(getThreadStatusIcon("Closed"), "✅");
			assert.strictEqual(getThreadStatusIcon("closed"), "✅");
		});

		test("should return ⏱️ for 'Pending'", () => {
			assert.strictEqual(getThreadStatusIcon("Pending"), "⏱️");
			assert.strictEqual(getThreadStatusIcon("pending"), "⏱️");
		});

		test("should return 🚫 for 'Won't Fix'", () => {
			assert.strictEqual(getThreadStatusIcon("Won't Fix"), "🚫");
			assert.strictEqual(getThreadStatusIcon("won't fix"), "🚫");
		});

		test("should return 🚫 for 'By Design'", () => {
			assert.strictEqual(getThreadStatusIcon("By Design"), "🚫");
			assert.strictEqual(getThreadStatusIcon("by design"), "🚫");
		});

		test("should return 💬 for unknown status", () => {
			assert.strictEqual(getThreadStatusIcon("Unknown"), "💬");
			assert.strictEqual(getThreadStatusIcon("Custom"), "💬");
			assert.strictEqual(getThreadStatusIcon(""), "💬");
		});
	});

	suite("cleanCommentContent", () => {
		test("should remove single GUID mention", () => {
			const content = "Hey @<5B8B71B7-3EB7-6574-B377-A695965DBDA8>, can you review this?";
			const result = cleanCommentContent(content);
			assert.strictEqual(result, "Hey @user, can you review this?");
		});

		test("should remove multiple GUID mentions", () => {
			const content =
				"@<5B8B71B7-3EB7-6574-B377-A695965DBDA8> and @<ABCD1234-5678-90EF-1234-567890ABCDEF> please review";
			const result = cleanCommentContent(content);
			assert.strictEqual(result, "@user and @user please review");
		});

		test("should handle lowercase GUIDs", () => {
			const content = "@<5b8b71b7-3eb7-6574-b377-a695965dbda8> lowercase guid";
			const result = cleanCommentContent(content);
			assert.strictEqual(result, "@user lowercase guid");
		});

		test("should handle mixed case GUIDs", () => {
			const content = "@<5B8b71B7-3Eb7-6574-B377-a695965DBDA8> mixed case";
			const result = cleanCommentContent(content);
			assert.strictEqual(result, "@user mixed case");
		});

		test("should preserve normal @mentions", () => {
			const content = "@john.doe please check this";
			const result = cleanCommentContent(content);
			assert.strictEqual(result, "@john.doe please check this");
		});

		test("should preserve content without mentions", () => {
			const content = "This is a regular comment without mentions";
			const result = cleanCommentContent(content);
			assert.strictEqual(result, content);
		});

		test("should trim whitespace", () => {
			const content = "  Comment with spaces  ";
			const result = cleanCommentContent(content);
			assert.strictEqual(result, "Comment with spaces");
		});

		test("should handle empty string", () => {
			const result = cleanCommentContent("");
			assert.strictEqual(result, "");
		});

		test("should handle string with only GUID mention", () => {
			const content = "@<5B8B71B7-3EB7-6574-B377-A695965DBDA8>";
			const result = cleanCommentContent(content);
			assert.strictEqual(result, "@user");
		});

		test("should handle multiline content with GUIDs", () => {
			const content = "Line 1 @<5B8B71B7-3EB7-6574-B377-A695965DBDA8>\nLine 2 content";
			const result = cleanCommentContent(content);
			assert.strictEqual(result, "Line 1 @user\nLine 2 content");
		});
	});

	suite("formatCommentHeaderMarkdown", () => {
		let clock: sinon.SinonFakeTimers;

		setup(() => {
			clock = sinon.useFakeTimers(new Date("2024-01-15T12:00:00Z").getTime());
		});

		teardown(() => {
			clock.restore();
		});

		test("should format basic comment header", () => {
			const comment = createMockComment({
				author: {
					id: "user-1",
					displayName: "John Doe",
					uniqueName: "john@example.com",
				},
				publishedDate: new Date("2024-01-15T11:00:00Z"),
				lastUpdatedDate: new Date("2024-01-15T11:00:00Z"),
			});

			const result = formatCommentHeaderMarkdown(comment);
			assert.strictEqual(result, "**John Doe** • 1h ago");
		});

		test("should include edited indicator when comment was edited", () => {
			const comment = createMockComment({
				author: {
					id: "user-1",
					displayName: "John Doe",
					uniqueName: "john@example.com",
				},
				publishedDate: new Date("2024-01-15T11:00:00Z"),
				lastUpdatedDate: new Date("2024-01-15T11:30:00Z"), // edited 30 min later
			});

			const result = formatCommentHeaderMarkdown(comment);
			assert.strictEqual(result, "**John Doe** • 1h ago • *(edited)*");
		});

		test("should include resolved status when includeStatus is true", () => {
			const comment = createMockComment({
				publishedDate: new Date("2024-01-15T11:00:00Z"),
				lastUpdatedDate: new Date("2024-01-15T11:00:00Z"),
			});

			const result = formatCommentHeaderMarkdown(comment, 2, true); // status 2 = Resolved
			assert.strictEqual(result, "**John Commenter** • 1h ago • ✅ Resolved");
		});

		test("should not include Active status even when includeStatus is true", () => {
			const comment = createMockComment({
				publishedDate: new Date("2024-01-15T11:00:00Z"),
				lastUpdatedDate: new Date("2024-01-15T11:00:00Z"),
			});

			const result = formatCommentHeaderMarkdown(comment, 1, true); // status 1 = Active
			assert.strictEqual(result, "**John Commenter** • 1h ago");
		});

		test("should not include status when includeStatus is false", () => {
			const comment = createMockComment({
				publishedDate: new Date("2024-01-15T11:00:00Z"),
				lastUpdatedDate: new Date("2024-01-15T11:00:00Z"),
			});

			const result = formatCommentHeaderMarkdown(comment, 2, false); // status 2 = Resolved
			assert.strictEqual(result, "**John Commenter** • 1h ago");
		});

		test("should include all parts when edited and resolved", () => {
			const comment = createMockComment({
				author: {
					id: "user-1",
					displayName: "Jane Smith",
					uniqueName: "jane@example.com",
				},
				publishedDate: new Date("2024-01-15T10:00:00Z"),
				lastUpdatedDate: new Date("2024-01-15T10:30:00Z"),
			});

			const result = formatCommentHeaderMarkdown(comment, 2, true); // Resolved
			assert.strictEqual(result, "**Jane Smith** • 2h ago • ✅ Resolved • *(edited)*");
		});

		test("should handle undefined threadStatus", () => {
			const comment = createMockComment({
				publishedDate: new Date("2024-01-15T11:00:00Z"),
				lastUpdatedDate: new Date("2024-01-15T11:00:00Z"),
			});

			const result = formatCommentHeaderMarkdown(comment, undefined, true);
			assert.strictEqual(result, "**John Commenter** • 1h ago");
		});

		test("should format header with 'just now' timestamp", () => {
			const comment = createMockComment({
				publishedDate: new Date("2024-01-15T12:00:00Z"), // right now
				lastUpdatedDate: new Date("2024-01-15T12:00:00Z"),
			});

			const result = formatCommentHeaderMarkdown(comment);
			assert.strictEqual(result, "**John Commenter** • just now");
		});
	});
});
