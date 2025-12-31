/**
 * Azure DevOps API Constants
 *
 * This file contains constant values used when interacting with the Azure DevOps REST API.
 * These values are defined by the Azure DevOps API specification and should not be modified
 * unless the API specification changes.
 */

/**
 * Thread status codes used in pull request comment threads
 * @see https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-threads
 */
export const THREAD_STATUS = {
	/** Thread is active and not resolved */
	ACTIVE: 1,
	/** Thread has been resolved or fixed */
	RESOLVED: 2,
	/** Thread will not be fixed */
	WONT_FIX: 3,
	/** Thread is closed */
	CLOSED: 4,
	/** Thread comment is by design (not an issue) */
	BY_DESIGN: 5,
	/** Thread status is pending */
	PENDING: 6,
} as const;

/**
 * Comment types used in pull request threads
 * @see https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-threads
 */
export const COMMENT_TYPE = {
	/** Standard text comment */
	TEXT: 1,
	/** System-generated comment */
	SYSTEM: 2,
} as const;

/**
 * Reviewer vote values for pull requests
 * @see https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-reviewers
 */
export const REVIEWER_VOTE = {
	/** Pull request is approved */
	APPROVED: 10,
	/** Pull request is approved with suggestions */
	APPROVED_WITH_SUGGESTIONS: 5,
	/** No vote has been cast */
	NO_VOTE: 0,
	/** Waiting for the author to make changes */
	WAITING_FOR_AUTHOR: -5,
	/** Pull request is rejected */
	REJECTED: -10,
} as const;

/**
 * Type definitions for the constants above
 */
export type ThreadStatus = (typeof THREAD_STATUS)[keyof typeof THREAD_STATUS];
export type CommentType = (typeof COMMENT_TYPE)[keyof typeof COMMENT_TYPE];
export type ReviewerVote = (typeof REVIEWER_VOTE)[keyof typeof REVIEWER_VOTE];
