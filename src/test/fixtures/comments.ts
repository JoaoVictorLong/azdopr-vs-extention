import { COMMENT_TYPE, THREAD_STATUS } from "../../constants/azureDevOpsConstants";
import type { PRComment, PRThread } from "../../services/azureDevOpsClient";

export const mockComment: PRComment = {
	id: 1,
	parentCommentId: 0,
	author: {
		id: "user-1",
		displayName: "John Commenter",
		uniqueName: "john@example.com",
		imageUrl: "https://example.com/avatar/john.jpg",
	},
	content: "This looks good! LGTM",
	publishedDate: new Date("2024-01-15T12:00:00Z"),
	lastUpdatedDate: new Date("2024-01-15T12:00:00Z"),
	commentType: COMMENT_TYPE.TEXT,
};

export const mockReplyComment: PRComment = {
	id: 2,
	parentCommentId: 1,
	author: {
		id: "user-2",
		displayName: "Jane Reviewer",
		uniqueName: "jane@example.com",
		imageUrl: "https://example.com/avatar/jane.jpg",
	},
	content: "Thanks for the review!",
	publishedDate: new Date("2024-01-15T12:30:00Z"),
	lastUpdatedDate: new Date("2024-01-15T12:30:00Z"),
	commentType: COMMENT_TYPE.TEXT,
};

export const mockSystemComment: PRComment = {
	id: 3,
	parentCommentId: 0,
	author: {
		id: "system",
		displayName: "Azure DevOps",
		uniqueName: "system@azure.com",
	},
	content: "Pull request created",
	publishedDate: new Date("2024-01-15T10:00:00Z"),
	lastUpdatedDate: new Date("2024-01-15T10:00:00Z"),
	commentType: COMMENT_TYPE.SYSTEM,
};

export const mockThread: PRThread = {
	id: 100,
	publishedDate: new Date("2024-01-15T12:00:00Z"),
	lastUpdatedDate: new Date("2024-01-15T12:30:00Z"),
	comments: [mockComment, mockReplyComment],
	status: THREAD_STATUS.ACTIVE,
	threadContext: {
		filePath: "/src/feature.ts",
		rightFileStart: { line: 10, offset: 0 },
		rightFileEnd: { line: 10, offset: 50 },
	},
};

export const mockResolvedThread: PRThread = {
	id: 101,
	publishedDate: new Date("2024-01-15T11:00:00Z"),
	lastUpdatedDate: new Date("2024-01-15T13:00:00Z"),
	comments: [
		{
			id: 10,
			parentCommentId: 0,
			author: {
				id: "user-1",
				displayName: "John Commenter",
				uniqueName: "john@example.com",
			},
			content: "Please fix this typo",
			publishedDate: new Date("2024-01-15T11:00:00Z"),
			lastUpdatedDate: new Date("2024-01-15T11:00:00Z"),
			commentType: COMMENT_TYPE.TEXT,
		},
		{
			id: 11,
			parentCommentId: 10,
			author: {
				id: "user-2",
				displayName: "Jane Developer",
				uniqueName: "jane@example.com",
			},
			content: "Fixed!",
			publishedDate: new Date("2024-01-15T12:00:00Z"),
			lastUpdatedDate: new Date("2024-01-15T12:00:00Z"),
			commentType: COMMENT_TYPE.TEXT,
		},
	],
	status: THREAD_STATUS.RESOLVED,
	threadContext: {
		filePath: "/src/feature.ts",
		rightFileStart: { line: 5, offset: 0 },
		rightFileEnd: { line: 5, offset: 30 },
	},
};

export const mockThreadWithoutContext: PRThread = {
	id: 102,
	publishedDate: new Date("2024-01-15T14:00:00Z"),
	lastUpdatedDate: new Date("2024-01-15T14:00:00Z"),
	comments: [
		{
			id: 20,
			parentCommentId: 0,
			author: {
				id: "user-1",
				displayName: "John Commenter",
				uniqueName: "john@example.com",
			},
			content: "General comment on the PR",
			publishedDate: new Date("2024-01-15T14:00:00Z"),
			lastUpdatedDate: new Date("2024-01-15T14:00:00Z"),
			commentType: COMMENT_TYPE.TEXT,
		},
	],
	status: THREAD_STATUS.ACTIVE,
};

/**
 * Factory function to create a mock comment with custom overrides
 */
export function createMockComment(overrides?: Partial<PRComment>): PRComment {
	return { ...mockComment, ...overrides };
}

/**
 * Factory function to create a mock thread with custom overrides
 */
export function createMockThread(overrides?: Partial<PRThread>): PRThread {
	return { ...mockThread, ...overrides };
}

/**
 * Create a thread with multiple comments
 */
export function createThreadWithComments(commentCount: number): PRThread {
	const comments: PRComment[] = [];
	const baseComment = createMockComment({ id: 1, parentCommentId: 0 });
	comments.push(baseComment);

	for (let i = 2; i <= commentCount; i++) {
		comments.push(
			createMockComment({
				id: i,
				parentCommentId: 1,
				content: `Reply ${i - 1}`,
				publishedDate: new Date(new Date("2024-01-15T12:00:00Z").getTime() + i * 60000),
			}),
		);
	}

	return createMockThread({ id: 200, comments });
}

/**
 * Create an active thread with file context
 */
export function createActiveThreadWithContext(filePath: string, line: number): PRThread {
	return createMockThread({
		id: 300,
		status: THREAD_STATUS.ACTIVE,
		threadContext: {
			filePath,
			rightFileStart: { line, offset: 0 },
			rightFileEnd: { line, offset: 100 },
		},
	});
}

/**
 * Create a resolved thread
 */
export function createResolvedThread(): PRThread {
	return createMockThread({
		id: 400,
		status: THREAD_STATUS.RESOLVED,
	});
}
