/**
 * Unit tests for Repository Matching Service
 */

import * as assert from "node:assert";
import { setup, suite, teardown, test } from "mocha";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { PullRequest } from "../../../services/azureDevOpsClient";
import {
	type GitBranch,
	type GitRemote,
	type GitRepository,
	type GitRepositoryState,
	GitService,
} from "../../../services/gitService";
import { RepositoryMatchingService } from "../../../services/repositoryMatchingService";

suite("RepositoryMatchingService", () => {
	let gitService: GitService;
	let matchingService: RepositoryMatchingService;
	let getAllRepositoriesStub: sinon.SinonStub;

	setup(() => {
		gitService = new GitService();
		matchingService = new RepositoryMatchingService(gitService, "myorg");
		getAllRepositoriesStub = sinon.stub(gitService, "getAllRepositories");
	});

	teardown(() => {
		sinon.restore();
	});

	// Helper: Create mock PR
	function createMockPR(org: string, project: string, repo: string): PullRequest {
		return {
			pullRequestId: 123,
			title: "Test PR",
			description: "Test description",
			createdBy: { displayName: "Test User", uniqueName: "test@example.com" },
			creationDate: new Date(),
			status: "active",
			repository: {
				id: "repo-id",
				name: repo,
				project: {
					id: "project-id",
					name: project,
				},
			},
			reviewers: [],
			url: `https://dev.azure.com/${org}/${project}/_git/${repo}/pullrequest/123`,
			sourceRefName: "refs/heads/feature/test",
			targetRefName: "refs/heads/main",
			isDraft: false,
		};
	}

	// Helper: Create mock Git repository
	function createMockGitRepo(remoteName: string, remoteUrl: string): GitRepository {
		const mockRemote: GitRemote = {
			name: remoteName,
			fetchUrl: remoteUrl,
			pushUrl: remoteUrl,
			isReadOnly: false,
		};

		const mockBranch: GitBranch = {
			name: "main",
			commit: "abc123",
			type: 0,
		};

		const mockState: GitRepositoryState = {
			HEAD: mockBranch,
			refs: [mockBranch],
			remotes: [mockRemote],
			workingTreeChanges: [],
			indexChanges: [],
		};

		return {
			rootUri: vscode.Uri.file("/workspace/repo"),
			state: mockState,
			fetch: async () => {},
			checkout: async () => {},
			getBranch: async () => mockBranch,
			createBranch: async () => {},
		};
	}

	suite("findMatchingRepository", () => {
		test("should return exact match for HTTPS dev.azure.com URL", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");
			const repo = createMockGitRepo("origin", "https://dev.azure.com/myorg/myproject/_git/myrepo");

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.ok(match);
			assert.strictEqual(match.confidence, "exact");
			assert.strictEqual(match.remoteName, "origin");
			assert.strictEqual(match.repository, repo);
		});

		test("should return exact match for HTTPS visualstudio.com URL", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");
			const repo = createMockGitRepo(
				"origin",
				"https://myorg.visualstudio.com/myproject/_git/myrepo",
			);

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.ok(match);
			assert.strictEqual(match.confidence, "exact");
		});

		test("should return exact match for SSH dev.azure.com URL", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");
			const repo = createMockGitRepo("origin", "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo");

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.ok(match);
			assert.strictEqual(match.confidence, "exact");
		});

		test("should handle repository name with .git suffix", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");
			const repo = createMockGitRepo(
				"origin",
				"https://dev.azure.com/myorg/myproject/_git/myrepo.git",
			);

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.ok(match);
			assert.strictEqual(match.confidence, "exact");
		});

		test("should return null when no repositories exist", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");

			getAllRepositoriesStub.returns([]);

			const match = matchingService.findMatchingRepository(pr);

			assert.strictEqual(match, null);
		});

		test("should return null when repository does not match", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");
			const repo = createMockGitRepo(
				"origin",
				"https://dev.azure.com/otherorg/otherproject/_git/otherrepo",
			);

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.strictEqual(match, null);
		});

		test("should return null when remote is not Azure DevOps", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");
			const repo = createMockGitRepo("origin", "https://github.com/user/repo");

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.strictEqual(match, null);
		});

		test("should prefer 'origin' over 'upstream'", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");

			const mockRemote1: GitRemote = {
				name: "upstream",
				fetchUrl: "https://dev.azure.com/otherorg/myproject/_git/myrepo",
				pushUrl: "https://dev.azure.com/otherorg/myproject/_git/myrepo",
				isReadOnly: false,
			};

			const mockRemote2: GitRemote = {
				name: "origin",
				fetchUrl: "https://dev.azure.com/myorg/myproject/_git/myrepo",
				pushUrl: "https://dev.azure.com/myorg/myproject/_git/myrepo",
				isReadOnly: false,
			};

			const mockState: GitRepositoryState = {
				HEAD: { name: "main", commit: "abc123", type: 0 },
				refs: [],
				remotes: [mockRemote1, mockRemote2],
				workingTreeChanges: [],
				indexChanges: [],
			};

			const repo: GitRepository = {
				rootUri: vscode.Uri.file("/workspace/repo"),
				state: mockState,
				fetch: async () => {},
				checkout: async () => {},
				getBranch: async () => undefined,
				createBranch: async () => {},
			};

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.ok(match);
			assert.strictEqual(match.remoteName, "origin");
			assert.strictEqual(match.confidence, "exact");
		});

		test("should fall back to 'upstream' if 'origin' does not match", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");

			const mockRemote1: GitRemote = {
				name: "origin",
				fetchUrl: "https://github.com/user/repo",
				pushUrl: "https://github.com/user/repo",
				isReadOnly: false,
			};

			const mockRemote2: GitRemote = {
				name: "upstream",
				fetchUrl: "https://dev.azure.com/myorg/myproject/_git/myrepo",
				pushUrl: "https://dev.azure.com/myorg/myproject/_git/myrepo",
				isReadOnly: false,
			};

			const mockState: GitRepositoryState = {
				HEAD: { name: "main", commit: "abc123", type: 0 },
				refs: [],
				remotes: [mockRemote1, mockRemote2],
				workingTreeChanges: [],
				indexChanges: [],
			};

			const repo: GitRepository = {
				rootUri: vscode.Uri.file("/workspace/repo"),
				state: mockState,
				fetch: async () => {},
				checkout: async () => {},
				getBranch: async () => undefined,
				createBranch: async () => {},
			};

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.ok(match);
			assert.strictEqual(match.remoteName, "upstream");
			assert.strictEqual(match.confidence, "exact");
		});

		test("should return partial match when repo name matches but org/project differ", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");
			const repo = createMockGitRepo(
				"origin",
				"https://dev.azure.com/otherorg/otherproject/_git/myrepo",
			);

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.ok(match);
			assert.strictEqual(match.confidence, "partial");
		});

		test("should handle multiple repositories and return first match", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");
			const repo1 = createMockGitRepo("origin", "https://github.com/user/repo");
			const repo2 = createMockGitRepo(
				"origin",
				"https://dev.azure.com/myorg/myproject/_git/myrepo",
			);
			const repo3 = createMockGitRepo(
				"origin",
				"https://dev.azure.com/myorg/myproject/_git/otherrepo",
			);

			getAllRepositoriesStub.returns([repo1, repo2, repo3]);

			const match = matchingService.findMatchingRepository(pr);

			assert.ok(match);
			assert.strictEqual(match.repository, repo2);
		});

		test("should handle repository with no remotes", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");

			const mockState: GitRepositoryState = {
				HEAD: { name: "main", commit: "abc123", type: 0 },
				refs: [],
				remotes: [],
				workingTreeChanges: [],
				indexChanges: [],
			};

			const repo: GitRepository = {
				rootUri: vscode.Uri.file("/workspace/repo"),
				state: mockState,
				fetch: async () => {},
				checkout: async () => {},
				getBranch: async () => undefined,
				createBranch: async () => {},
			};

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.strictEqual(match, null);
		});

		test("should handle remote without fetchUrl", () => {
			const pr = createMockPR("myorg", "myproject", "myrepo");

			const mockRemote: GitRemote = {
				name: "origin",
				fetchUrl: undefined,
				pushUrl: "https://dev.azure.com/myorg/myproject/_git/myrepo",
				isReadOnly: false,
			};

			const mockState: GitRepositoryState = {
				HEAD: { name: "main", commit: "abc123", type: 0 },
				refs: [],
				remotes: [mockRemote],
				workingTreeChanges: [],
				indexChanges: [],
			};

			const repo: GitRepository = {
				rootUri: vscode.Uri.file("/workspace/repo"),
				state: mockState,
				fetch: async () => {},
				checkout: async () => {},
				getBranch: async () => undefined,
				createBranch: async () => {},
			};

			getAllRepositoriesStub.returns([repo]);

			const match = matchingService.findMatchingRepository(pr);

			assert.strictEqual(match, null);
		});
	});
});
