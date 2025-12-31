import * as assert from "node:assert";
import { suite, test } from "mocha";
import { processCommentContent } from "../../../utils/markdownProcessor";

suite("markdownProcessor", () => {
	suite("processCommentContent", () => {
		test("should return MarkdownString for simple content", () => {
			const content = "This is a simple comment";
			const result = processCommentContent(content);

			assert.ok(result);
			assert.strictEqual(result.value, content);
		});

		test("should enhance @mentions with bold formatting", () => {
			const content = "Hey @john please review this";
			const result = processCommentContent(content);

			assert.ok(result.value.includes("**@john**"));
		});

		test("should enhance multiple @mentions", () => {
			const content = "@john and @jane please review";
			const result = processCommentContent(content);

			assert.ok(result.value.includes("**@john**"));
			assert.ok(result.value.includes("**@jane**"));
		});

		test("should enhance @mentions with spaces in names", () => {
			const content = "@John Doe please review";
			const result = processCommentContent(content);

			assert.ok(result.value.includes("**@John Doe**"));
		});

		test("should enhance @mentions with numbers", () => {
			const content = "@user123 please check";
			const result = processCommentContent(content);

			assert.ok(result.value.includes("**@user123**"));
		});

		test("should not modify content without mentions or work items", () => {
			const content = "This is a regular comment without special formatting";
			const result = processCommentContent(content);

			assert.strictEqual(result.value, content);
		});

		test("should linkify work item #123 when organizationUrl is provided", () => {
			const content = "Fixed issue #123";
			const orgUrl = "https://dev.azure.com/myorg";
			const result = processCommentContent(content, orgUrl);

			assert.ok(result.value.includes("[#123](https://dev.azure.com/myorg/_workitems/edit/123)"));
		});

		test("should linkify multiple work items", () => {
			const content = "Fixed #123 and #456";
			const orgUrl = "https://dev.azure.com/myorg";
			const result = processCommentContent(content, orgUrl);

			assert.ok(result.value.includes("[#123]("));
			assert.ok(result.value.includes("[#456]("));
		});

		test("should not linkify work items when organizationUrl is not provided", () => {
			const content = "Fixed issue #123";
			const result = processCommentContent(content);

			// Should still have #123 but not as a link
			assert.ok(result.value.includes("#123"));
			assert.ok(!result.value.includes("[#123]("));
		});

		test("should handle both mentions and work items together", () => {
			const content = "@john fixed #123";
			const orgUrl = "https://dev.azure.com/myorg";
			const result = processCommentContent(content, orgUrl);

			assert.ok(result.value.includes("**@john**"));
			assert.ok(result.value.includes("[#123]("));
		});

		test("should handle work items at start of line", () => {
			const content = "#123 needs review";
			const orgUrl = "https://dev.azure.com/myorg";
			const result = processCommentContent(content, orgUrl);

			assert.ok(result.value.includes("[#123]("));
		});

		test("should handle work items at end of line", () => {
			const content = "Fixed in #123";
			const orgUrl = "https://dev.azure.com/myorg";
			const result = processCommentContent(content, orgUrl);

			assert.ok(result.value.includes("[#123]("));
		});

		test("should handle multiline content with mentions", () => {
			const content = "@john please review\nLine 2 content\n@jane second reviewer";
			const result = processCommentContent(content);

			assert.ok(result.value.includes("**@john**"));
			assert.ok(result.value.includes("**@jane**"));
		});

		test("should handle multiline content with work items", () => {
			const content = "Fixed #123\nAlso fixed #456";
			const orgUrl = "https://dev.azure.com/myorg";
			const result = processCommentContent(content, orgUrl);

			assert.ok(result.value.includes("[#123]("));
			assert.ok(result.value.includes("[#456]("));
		});

		test("should preserve existing markdown formatting", () => {
			const content = "**Bold** and *italic* text";
			const result = processCommentContent(content);

			assert.ok(result.value.includes("**Bold**"));
			assert.ok(result.value.includes("*italic*"));
		});

		test("should preserve code blocks", () => {
			const content = "Here's some code: `console.log('hello')`";
			const result = processCommentContent(content);

			assert.ok(result.value.includes("`console.log('hello')`"));
		});

		test("should handle empty content", () => {
			const result = processCommentContent("");

			assert.strictEqual(result.value, "");
		});

		test("should set MarkdownString properties correctly", () => {
			const content = "Test content";
			const result = processCommentContent(content);

			assert.strictEqual(result.supportThemeIcons, true);
			assert.strictEqual(result.isTrusted, true);
			assert.strictEqual(result.supportHtml, false);
		});

		test("should handle special characters in content", () => {
			const content = "Special chars: <>&\"'";
			const result = processCommentContent(content);

			assert.ok(result.value.includes("<>&\"'"));
		});

		test("should handle work item IDs with multiple digits", () => {
			const content = "Fixed #12345";
			const orgUrl = "https://dev.azure.com/myorg";
			const result = processCommentContent(content, orgUrl);

			assert.ok(result.value.includes("[#12345]("));
			assert.ok(result.value.includes("_workitems/edit/12345"));
		});

		test("should not linkify # symbols that are not followed by digits", () => {
			const content = "Use #hashtag for tagging";
			const orgUrl = "https://dev.azure.com/myorg";
			const result = processCommentContent(content, orgUrl);

			// Should not convert #hashtag to a link
			assert.ok(!result.value.includes("[#hashtag]("));
		});

		test("should handle @ symbols that are not mentions", () => {
			const content = "Email: test@example.com";
			const result = processCommentContent(content);

			// The @ in email should still be processed but won't look like a mention
			assert.ok(result.value.includes("@"));
		});
	});
});
