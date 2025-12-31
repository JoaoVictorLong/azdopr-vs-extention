/**
 * Unit tests for Azure DevOps URL Parser
 */

import * as assert from "node:assert";
import { describe, it } from "mocha";
import { AzureDevOpsUrlParser } from "../../../utils/azureDevOpsUrlParser";

describe("AzureDevOpsUrlParser", () => {
	describe("parse() - HTTPS dev.azure.com URLs", () => {
		it("should parse standard HTTPS dev.azure.com URL", () => {
			const result = AzureDevOpsUrlParser.parse(
				"https://dev.azure.com/myorg/myproject/_git/myrepo",
			);

			assert.deepStrictEqual(result, {
				organization: "myorg",
				project: "myproject",
				repository: "myrepo",
				isAzureDevOps: true,
			});
		});

		it("should parse HTTPS dev.azure.com URL with credentials", () => {
			const result = AzureDevOpsUrlParser.parse(
				"https://username@dev.azure.com/myorg/myproject/_git/myrepo",
			);

			assert.deepStrictEqual(result, {
				organization: "myorg",
				project: "myproject",
				repository: "myrepo",
				isAzureDevOps: true,
			});
		});

		it("should normalize repository name with .git suffix", () => {
			const result = AzureDevOpsUrlParser.parse(
				"https://dev.azure.com/myorg/myproject/_git/myrepo.git",
			);

			assert.strictEqual(result?.repository, "myrepo");
		});

		it("should handle org names with hyphens", () => {
			const result = AzureDevOpsUrlParser.parse(
				"https://dev.azure.com/my-org-name/myproject/_git/myrepo",
			);

			assert.strictEqual(result?.organization, "my-org-name");
		});

		it("should handle project names with spaces (URL encoded)", () => {
			const result = AzureDevOpsUrlParser.parse(
				"https://dev.azure.com/myorg/My%20Project/_git/myrepo",
			);

			assert.strictEqual(result?.project, "My%20Project");
		});
	});

	describe("parse() - HTTPS visualstudio.com URLs", () => {
		it("should parse standard HTTPS visualstudio.com URL", () => {
			const result = AzureDevOpsUrlParser.parse(
				"https://myorg.visualstudio.com/myproject/_git/myrepo",
			);

			assert.deepStrictEqual(result, {
				organization: "myorg",
				project: "myproject",
				repository: "myrepo",
				isAzureDevOps: true,
			});
		});

		it("should parse HTTPS visualstudio.com URL with DefaultCollection", () => {
			const result = AzureDevOpsUrlParser.parse(
				"https://myorg.visualstudio.com/DefaultCollection/myproject/_git/myrepo",
			);

			assert.deepStrictEqual(result, {
				organization: "myorg",
				project: "myproject",
				repository: "myrepo",
				isAzureDevOps: true,
			});
		});

		it("should normalize repository name with .git suffix", () => {
			const result = AzureDevOpsUrlParser.parse(
				"https://myorg.visualstudio.com/myproject/_git/myrepo.git",
			);

			assert.strictEqual(result?.repository, "myrepo");
		});
	});

	describe("parse() - SSH dev.azure.com URLs", () => {
		it("should parse SSH dev.azure.com URL", () => {
			const result = AzureDevOpsUrlParser.parse("git@ssh.dev.azure.com:v3/myorg/myproject/myrepo");

			assert.deepStrictEqual(result, {
				organization: "myorg",
				project: "myproject",
				repository: "myrepo",
				isAzureDevOps: true,
			});
		});

		it("should normalize repository name with .git suffix", () => {
			const result = AzureDevOpsUrlParser.parse(
				"git@ssh.dev.azure.com:v3/myorg/myproject/myrepo.git",
			);

			assert.strictEqual(result?.repository, "myrepo");
		});

		it("should handle repo names with hyphens and underscores", () => {
			const result = AzureDevOpsUrlParser.parse(
				"git@ssh.dev.azure.com:v3/myorg/myproject/my-repo_name",
			);

			assert.strictEqual(result?.repository, "my-repo_name");
		});
	});

	describe("parse() - SSH visualstudio.com URLs", () => {
		it("should parse SSH visualstudio.com URL", () => {
			const result = AzureDevOpsUrlParser.parse(
				"myorg@vs-ssh.visualstudio.com:v3/myorg/myproject/myrepo",
			);

			assert.deepStrictEqual(result, {
				organization: "myorg",
				project: "myproject",
				repository: "myrepo",
				isAzureDevOps: true,
			});
		});

		it("should normalize repository name with .git suffix", () => {
			const result = AzureDevOpsUrlParser.parse(
				"myorg@vs-ssh.visualstudio.com:v3/myorg/myproject/myrepo.git",
			);

			assert.strictEqual(result?.repository, "myrepo");
		});
	});

	describe("parse() - Non-Azure DevOps URLs", () => {
		it("should return null for GitHub URL", () => {
			const result = AzureDevOpsUrlParser.parse("https://github.com/user/repo");

			assert.strictEqual(result, null);
		});

		it("should return null for GitLab URL", () => {
			const result = AzureDevOpsUrlParser.parse("https://gitlab.com/user/repo");

			assert.strictEqual(result, null);
		});

		it("should return null for Bitbucket URL", () => {
			const result = AzureDevOpsUrlParser.parse("https://bitbucket.org/user/repo");

			assert.strictEqual(result, null);
		});

		it("should return null for empty string", () => {
			const result = AzureDevOpsUrlParser.parse("");

			assert.strictEqual(result, null);
		});

		it("should return null for invalid URL", () => {
			const result = AzureDevOpsUrlParser.parse("not-a-url");

			assert.strictEqual(result, null);
		});
	});

	describe("parse() - Edge Cases", () => {
		it("should handle repo names with multiple dots", () => {
			const result = AzureDevOpsUrlParser.parse(
				"https://dev.azure.com/myorg/myproject/_git/my.repo.name",
			);

			assert.strictEqual(result?.repository, "my.repo.name");
		});

		it("should handle very long org names", () => {
			const longOrg = "a".repeat(100);
			const result = AzureDevOpsUrlParser.parse(
				`https://dev.azure.com/${longOrg}/myproject/_git/myrepo`,
			);

			assert.strictEqual(result?.organization, longOrg);
		});
	});

	describe("normalizeRepoName()", () => {
		it("should remove .git suffix", () => {
			const result = AzureDevOpsUrlParser.normalizeRepoName("myrepo.git");
			assert.strictEqual(result, "myrepo");
		});

		it("should leave repo name unchanged if no .git suffix", () => {
			const result = AzureDevOpsUrlParser.normalizeRepoName("myrepo");
			assert.strictEqual(result, "myrepo");
		});

		it("should only remove trailing .git", () => {
			const result = AzureDevOpsUrlParser.normalizeRepoName("my.git.repo.git");
			assert.strictEqual(result, "my.git.repo");
		});

		it("should handle empty string", () => {
			const result = AzureDevOpsUrlParser.normalizeRepoName("");
			assert.strictEqual(result, "");
		});

		it("should handle .git as the entire name", () => {
			const result = AzureDevOpsUrlParser.normalizeRepoName(".git");
			assert.strictEqual(result, "");
		});
	});
});
