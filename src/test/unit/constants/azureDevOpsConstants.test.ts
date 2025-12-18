import * as assert from "node:assert";
import { suite, test } from "mocha";
import {
	COMMENT_TYPE,
	REVIEWER_VOTE,
	THREAD_STATUS,
} from "../../../constants/azureDevOpsConstants";

suite("azureDevOpsConstants", () => {
	suite("THREAD_STATUS", () => {
		test("should have correct ACTIVE status value", () => {
			assert.strictEqual(THREAD_STATUS.ACTIVE, 1);
		});

		test("should have correct RESOLVED status value", () => {
			assert.strictEqual(THREAD_STATUS.RESOLVED, 2);
		});

		test("should have correct WONT_FIX status value", () => {
			assert.strictEqual(THREAD_STATUS.WONT_FIX, 3);
		});

		test("should have correct CLOSED status value", () => {
			assert.strictEqual(THREAD_STATUS.CLOSED, 4);
		});

		test("should have correct BY_DESIGN status value", () => {
			assert.strictEqual(THREAD_STATUS.BY_DESIGN, 5);
		});

		test("should have correct PENDING status value", () => {
			assert.strictEqual(THREAD_STATUS.PENDING, 6);
		});

		test("should be a readonly object", () => {
			const statusKeys = Object.keys(THREAD_STATUS);
			assert.strictEqual(statusKeys.length, 6);
			assert.ok(statusKeys.includes("ACTIVE"));
			assert.ok(statusKeys.includes("RESOLVED"));
			assert.ok(statusKeys.includes("WONT_FIX"));
			assert.ok(statusKeys.includes("CLOSED"));
			assert.ok(statusKeys.includes("BY_DESIGN"));
			assert.ok(statusKeys.includes("PENDING"));
		});
	});

	suite("COMMENT_TYPE", () => {
		test("should have correct TEXT type value", () => {
			assert.strictEqual(COMMENT_TYPE.TEXT, 1);
		});

		test("should have correct SYSTEM type value", () => {
			assert.strictEqual(COMMENT_TYPE.SYSTEM, 2);
		});

		test("should be a readonly object", () => {
			const typeKeys = Object.keys(COMMENT_TYPE);
			assert.strictEqual(typeKeys.length, 2);
			assert.ok(typeKeys.includes("TEXT"));
			assert.ok(typeKeys.includes("SYSTEM"));
		});
	});

	suite("REVIEWER_VOTE", () => {
		test("should have correct APPROVED vote value", () => {
			assert.strictEqual(REVIEWER_VOTE.APPROVED, 10);
		});

		test("should have correct APPROVED_WITH_SUGGESTIONS vote value", () => {
			assert.strictEqual(REVIEWER_VOTE.APPROVED_WITH_SUGGESTIONS, 5);
		});

		test("should have correct NO_VOTE value", () => {
			assert.strictEqual(REVIEWER_VOTE.NO_VOTE, 0);
		});

		test("should have correct WAITING_FOR_AUTHOR vote value", () => {
			assert.strictEqual(REVIEWER_VOTE.WAITING_FOR_AUTHOR, -5);
		});

		test("should have correct REJECTED vote value", () => {
			assert.strictEqual(REVIEWER_VOTE.REJECTED, -10);
		});

		test("should be a readonly object", () => {
			const voteKeys = Object.keys(REVIEWER_VOTE);
			assert.strictEqual(voteKeys.length, 5);
			assert.ok(voteKeys.includes("APPROVED"));
			assert.ok(voteKeys.includes("APPROVED_WITH_SUGGESTIONS"));
			assert.ok(voteKeys.includes("NO_VOTE"));
			assert.ok(voteKeys.includes("WAITING_FOR_AUTHOR"));
			assert.ok(voteKeys.includes("REJECTED"));
		});

		test("should have vote values in correct order", () => {
			// Approved votes are positive
			assert.ok(REVIEWER_VOTE.APPROVED > REVIEWER_VOTE.APPROVED_WITH_SUGGESTIONS);
			assert.ok(REVIEWER_VOTE.APPROVED_WITH_SUGGESTIONS > REVIEWER_VOTE.NO_VOTE);

			// Negative votes indicate issues
			assert.ok(REVIEWER_VOTE.NO_VOTE > REVIEWER_VOTE.WAITING_FOR_AUTHOR);
			assert.ok(REVIEWER_VOTE.WAITING_FOR_AUTHOR > REVIEWER_VOTE.REJECTED);
		});
	});
});
