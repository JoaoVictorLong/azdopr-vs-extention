import * as assert from "node:assert";

/**
 * Custom assertion helpers for tests
 */

/**
 * Assert that a value is defined (not null or undefined)
 */
export function assertDefined<T>(
	value: T | null | undefined,
	message?: string,
): asserts value is T {
	assert.ok(value !== null && value !== undefined, message || "Value should be defined");
}

/**
 * Assert that an array contains a specific item
 */
export function assertArrayContains<T>(array: T[], item: T, message?: string): void {
	assert.ok(array.includes(item), message || `Array should contain item: ${JSON.stringify(item)}`);
}

/**
 * Assert that an array does not contain a specific item
 */
export function assertArrayDoesNotContain<T>(array: T[], item: T, message?: string): void {
	assert.ok(
		!array.includes(item),
		message || `Array should not contain item: ${JSON.stringify(item)}`,
	);
}

/**
 * Assert that an object has a specific property
 */
export function assertHasProperty<T extends object, K extends string>(
	obj: T,
	property: K,
	message?: string,
): asserts obj is T & Record<K, unknown> {
	assert.ok(property in obj, message || `Object should have property: ${property}`);
}

/**
 * Assert that two dates are equal (within a tolerance)
 */
export function assertDatesEqual(
	actual: Date,
	expected: Date,
	toleranceMs = 1000,
	message?: string,
): void {
	const diff = Math.abs(actual.getTime() - expected.getTime());
	assert.ok(
		diff <= toleranceMs,
		message ||
			`Dates should be equal within ${toleranceMs}ms. Actual: ${actual.toISOString()}, Expected: ${expected.toISOString()}, Diff: ${diff}ms`,
	);
}

/**
 * Assert that a function throws an error with a specific message
 */
export function assertThrowsWithMessage(
	fn: () => void,
	expectedMessage: string | RegExp,
	message?: string,
): void {
	try {
		fn();
		assert.fail(message || "Function should have thrown an error");
	} catch (error) {
		if (error instanceof Error) {
			if (typeof expectedMessage === "string") {
				assert.strictEqual(
					error.message,
					expectedMessage,
					message || `Error message should match. Got: ${error.message}`,
				);
			} else {
				assert.match(
					error.message,
					expectedMessage,
					message || `Error message should match pattern`,
				);
			}
		} else {
			assert.fail("Thrown value should be an Error instance");
		}
	}
}

/**
 * Assert that an async function rejects with a specific message
 */
export async function assertRejectsWithMessage(
	fn: () => Promise<void>,
	expectedMessage: string | RegExp,
	message?: string,
): Promise<void> {
	try {
		await fn();
		assert.fail(message || "Function should have rejected");
	} catch (error) {
		if (error instanceof Error) {
			if (typeof expectedMessage === "string") {
				assert.strictEqual(
					error.message,
					expectedMessage,
					message || `Error message should match. Got: ${error.message}`,
				);
			} else {
				assert.match(
					error.message,
					expectedMessage,
					message || `Error message should match pattern`,
				);
			}
		} else {
			assert.fail("Rejected value should be an Error instance");
		}
	}
}

/**
 * Assert that a value is within a range
 */
export function assertInRange(value: number, min: number, max: number, message?: string): void {
	assert.ok(
		value >= min && value <= max,
		message || `Value ${value} should be between ${min} and ${max}`,
	);
}

/**
 * Assert that a string matches a pattern
 */
export function assertMatches(value: string, pattern: RegExp, message?: string): void {
	assert.match(value, pattern, message);
}

/**
 * Assert that a string does not match a pattern
 */
export function assertDoesNotMatch(value: string, pattern: RegExp, message?: string): void {
	assert.doesNotMatch(value, pattern, message);
}
