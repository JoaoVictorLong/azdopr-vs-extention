import * as assert from "node:assert";
import { suite, test } from "mocha";
import {
	CACHE_CLEANUP_INTERVAL_MS,
	COMMENT_DEBOUNCE_MS,
	MIN_REFRESH_INTERVAL_MS,
	PR_CACHE_TTL_MS,
} from "../../../constants/cacheConfig";

suite("cacheConfig", () => {
	suite("PR_CACHE_TTL_MS", () => {
		test("should be 5 minutes in milliseconds", () => {
			const expectedMs = 5 * 60 * 1000;
			assert.strictEqual(PR_CACHE_TTL_MS, expectedMs);
			assert.strictEqual(PR_CACHE_TTL_MS, 300000);
		});

		test("should be a positive number", () => {
			assert.ok(PR_CACHE_TTL_MS > 0);
			assert.strictEqual(typeof PR_CACHE_TTL_MS, "number");
		});
	});

	suite("CACHE_CLEANUP_INTERVAL_MS", () => {
		test("should be 1 minute in milliseconds", () => {
			const expectedMs = 60 * 1000;
			assert.strictEqual(CACHE_CLEANUP_INTERVAL_MS, expectedMs);
			assert.strictEqual(CACHE_CLEANUP_INTERVAL_MS, 60000);
		});

		test("should be a positive number", () => {
			assert.ok(CACHE_CLEANUP_INTERVAL_MS > 0);
			assert.strictEqual(typeof CACHE_CLEANUP_INTERVAL_MS, "number");
		});

		test("should be less than cache TTL", () => {
			// Cleanup should run more frequently than cache expiration
			assert.ok(CACHE_CLEANUP_INTERVAL_MS < PR_CACHE_TTL_MS);
		});
	});

	suite("MIN_REFRESH_INTERVAL_MS", () => {
		test("should be 5 seconds in milliseconds", () => {
			const expectedMs = 5000;
			assert.strictEqual(MIN_REFRESH_INTERVAL_MS, expectedMs);
		});

		test("should be a positive number", () => {
			assert.ok(MIN_REFRESH_INTERVAL_MS > 0);
			assert.strictEqual(typeof MIN_REFRESH_INTERVAL_MS, "number");
		});

		test("should be reasonably short for refresh operations", () => {
			// Should be less than a minute for reasonable UX
			assert.ok(MIN_REFRESH_INTERVAL_MS < 60000);
		});
	});

	suite("COMMENT_DEBOUNCE_MS", () => {
		test("should be 50 milliseconds", () => {
			assert.strictEqual(COMMENT_DEBOUNCE_MS, 50);
		});

		test("should be a positive number", () => {
			assert.ok(COMMENT_DEBOUNCE_MS > 0);
			assert.strictEqual(typeof COMMENT_DEBOUNCE_MS, "number");
		});

		test("should be very short for debouncing", () => {
			// Debounce should be less than 1 second for good UX
			assert.ok(COMMENT_DEBOUNCE_MS < 1000);
		});

		test("should be the shortest interval", () => {
			// Debounce should be shorter than all other intervals
			assert.ok(COMMENT_DEBOUNCE_MS < MIN_REFRESH_INTERVAL_MS);
			assert.ok(COMMENT_DEBOUNCE_MS < CACHE_CLEANUP_INTERVAL_MS);
			assert.ok(COMMENT_DEBOUNCE_MS < PR_CACHE_TTL_MS);
		});
	});

	suite("interval relationships", () => {
		test("should have intervals in logical order", () => {
			// Order: debounce < min refresh < cleanup < cache TTL
			assert.ok(COMMENT_DEBOUNCE_MS < MIN_REFRESH_INTERVAL_MS);
			assert.ok(MIN_REFRESH_INTERVAL_MS < CACHE_CLEANUP_INTERVAL_MS);
			assert.ok(CACHE_CLEANUP_INTERVAL_MS < PR_CACHE_TTL_MS);
		});

		test("should all be finite numbers", () => {
			assert.ok(Number.isFinite(PR_CACHE_TTL_MS));
			assert.ok(Number.isFinite(CACHE_CLEANUP_INTERVAL_MS));
			assert.ok(Number.isFinite(MIN_REFRESH_INTERVAL_MS));
			assert.ok(Number.isFinite(COMMENT_DEBOUNCE_MS));
		});

		test("should all be integers", () => {
			assert.ok(Number.isInteger(PR_CACHE_TTL_MS));
			assert.ok(Number.isInteger(CACHE_CLEANUP_INTERVAL_MS));
			assert.ok(Number.isInteger(MIN_REFRESH_INTERVAL_MS));
			assert.ok(Number.isInteger(COMMENT_DEBOUNCE_MS));
		});
	});
});
