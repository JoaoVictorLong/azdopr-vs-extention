import type {
	PRFileChange,
	PRIteration,
	Project,
	PullRequest,
	Repository,
} from "../../services/azureDevOpsClient";

export const mockProject: Project = {
	id: "proj-123",
	name: "Test Project",
	description: "A test project for unit testing",
	state: "wellFormed",
};

export const mockRepository: Repository = {
	id: "repo-456",
	name: "test-repo",
	project: {
		id: "proj-123",
		name: "Test Project",
	},
};

export const mockPullRequest: PullRequest = {
	pullRequestId: 123,
	title: "Test PR: Add new feature",
	description: "This is a test pull request for unit testing",
	createdBy: {
		displayName: "John Doe",
		uniqueName: "john.doe@example.com",
	},
	creationDate: new Date("2024-01-15T10:00:00Z"),
	status: "active",
	repository: {
		id: "repo-456",
		name: "test-repo",
		project: {
			id: "proj-123",
			name: "Test Project",
		},
	},
	reviewers: [
		{
			id: "user-1",
			displayName: "Jane Reviewer",
			uniqueName: "jane@example.com",
			imageUrl: "https://example.com/avatar/jane.jpg",
			vote: 10,
			isRequired: true,
		},
		{
			id: "user-2",
			displayName: "Bob Approver",
			uniqueName: "bob@example.com",
			vote: 5,
			isRequired: false,
		},
	],
	url: "https://dev.azure.com/org/proj/_git/repo/pullrequest/123",
	sourceRefName: "refs/heads/feature/new-feature",
	targetRefName: "refs/heads/main",
	isDraft: false,
	lastMergeSourceCommit: {
		commitId: "abc123def456789abcdef0123456789abcdef01",
	},
	lastMergeTargetCommit: {
		commitId: "def456abc123456789abcdef0123456789abcdef",
	},
};

export const mockPRIteration: PRIteration = {
	id: 1,
	description: "Initial iteration",
	author: {
		displayName: "John Doe",
		uniqueName: "john.doe@example.com",
	},
	createdDate: new Date("2024-01-15T10:00:00Z"),
	updatedDate: new Date("2024-01-15T11:00:00Z"),
};

export const mockPRFileChange: PRFileChange = {
	changeId: 1,
	changeType: "edit",
	item: {
		path: "/src/feature.ts",
		isFolder: false,
	},
};

export const mockPRFileChangeAdd: PRFileChange = {
	changeId: 2,
	changeType: "add",
	item: {
		path: "/src/newFile.ts",
		isFolder: false,
	},
};

export const mockPRFileChangeDelete: PRFileChange = {
	changeId: 3,
	changeType: "delete",
	item: {
		path: "/src/oldFile.ts",
		isFolder: false,
	},
};

export const mockPRFileChangeRename: PRFileChange = {
	changeId: 4,
	changeType: "rename",
	item: {
		path: "/src/renamedFile.ts",
		isFolder: false,
	},
	originalPath: "/src/originalFile.ts",
};

/**
 * Factory function to create a mock PR with custom overrides
 */
export function createMockPR(overrides?: Partial<PullRequest>): PullRequest {
	return { ...mockPullRequest, ...overrides };
}

/**
 * Factory function to create a mock PR iteration with custom overrides
 */
export function createMockIteration(overrides?: Partial<PRIteration>): PRIteration {
	return { ...mockPRIteration, ...overrides };
}

/**
 * Factory function to create a mock file change with custom overrides
 */
export function createMockFileChange(overrides?: Partial<PRFileChange>): PRFileChange {
	return { ...mockPRFileChange, ...overrides };
}

/**
 * Factory function to create a mock project with custom overrides
 */
export function createMockProject(overrides?: Partial<Project>): Project {
	return { ...mockProject, ...overrides };
}

/**
 * Factory function to create a mock repository with custom overrides
 */
export function createMockRepository(overrides?: Partial<Repository>): Repository {
	return { ...mockRepository, ...overrides };
}

/**
 * Create a draft PR
 */
export function createDraftPR(): PullRequest {
	return createMockPR({
		isDraft: true,
		pullRequestId: 124,
		title: "[DRAFT] Work in progress",
	});
}

/**
 * Create a completed PR
 */
export function createCompletedPR(): PullRequest {
	return createMockPR({
		status: "completed",
		pullRequestId: 125,
		title: "Completed: Feature implementation",
	});
}

/**
 * Create an abandoned PR
 */
export function createAbandonedPR(): PullRequest {
	return createMockPR({
		status: "abandoned",
		pullRequestId: 126,
		title: "Abandoned: Obsolete changes",
	});
}
