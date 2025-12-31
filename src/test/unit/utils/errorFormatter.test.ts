import * as assert from "node:assert";
import { suite, test } from "mocha";
import { formatErrorMessage, formatErrorWithPrefix } from "../../../utils/errorFormatter";

suite("errorFormatter", () => {
	suite("formatErrorMessage", () => {
		test("should format Error instance", () => {
			const error = new Error("Test error");
			const result = formatErrorMessage(error);
			assert.strictEqual(result, "Test error");
		});

		test("should format Error instance with empty message", () => {
			const error = new Error("");
			const result = formatErrorMessage(error);
			assert.strictEqual(result, "");
		});

		test("should handle string as error", () => {
			const result = formatErrorMessage("string error");
			assert.strictEqual(result, "[Non-Error type thrown: string]");
		});

		test("should handle number as error", () => {
			const result = formatErrorMessage(123);
			assert.strictEqual(result, "[Non-Error type thrown: number]");
		});

		test("should handle null as error", () => {
			const result = formatErrorMessage(null);
			assert.strictEqual(result, "[Non-Error type thrown: object]");
		});

		test("should handle undefined as error", () => {
			const result = formatErrorMessage(undefined);
			assert.strictEqual(result, "[Non-Error type thrown: undefined]");
		});

		test("should handle object as error", () => {
			const result = formatErrorMessage({ message: "object error" });
			assert.strictEqual(result, "[Non-Error type thrown: object]");
		});

		test("should handle array as error", () => {
			const result = formatErrorMessage(["error", "array"]);
			assert.strictEqual(result, "[Non-Error type thrown: object]");
		});

		test("should handle boolean as error", () => {
			const result = formatErrorMessage(false);
			assert.strictEqual(result, "[Non-Error type thrown: boolean]");
		});

		test("should handle symbol as error", () => {
			const result = formatErrorMessage(Symbol("error"));
			assert.strictEqual(result, "[Non-Error type thrown: symbol]");
		});

		test("should handle TypeError instance", () => {
			const error = new TypeError("Type error");
			const result = formatErrorMessage(error);
			assert.strictEqual(result, "Type error");
		});

		test("should handle RangeError instance", () => {
			const error = new RangeError("Range error");
			const result = formatErrorMessage(error);
			assert.strictEqual(result, "Range error");
		});

		test("should handle custom Error subclass", () => {
			class CustomError extends Error {
				constructor(message: string) {
					super(message);
					this.name = "CustomError";
				}
			}
			const error = new CustomError("Custom error");
			const result = formatErrorMessage(error);
			assert.strictEqual(result, "Custom error");
		});
	});

	suite("formatErrorWithPrefix", () => {
		test("should add prefix to Error instance", () => {
			const error = new Error("Connection failed");
			const result = formatErrorWithPrefix("API Error", error);
			assert.strictEqual(result, "API Error: Connection failed");
		});

		test("should add prefix to string error", () => {
			const result = formatErrorWithPrefix("Failed to load", "timeout");
			assert.strictEqual(result, "Failed to load: [Non-Error type thrown: string]");
		});

		test("should handle empty prefix", () => {
			const error = new Error("Test error");
			const result = formatErrorWithPrefix("", error);
			assert.strictEqual(result, ": Test error");
		});

		test("should handle long prefix", () => {
			const error = new Error("Error message");
			const longPrefix =
				"This is a very long prefix that provides detailed context about the error";
			const result = formatErrorWithPrefix(longPrefix, error);
			assert.strictEqual(result, `${longPrefix}: Error message`);
		});

		test("should handle prefix with special characters", () => {
			const error = new Error("Test error");
			const result = formatErrorWithPrefix("Error [Critical]", error);
			assert.strictEqual(result, "Error [Critical]: Test error");
		});

		test("should handle multiple error types with prefix", () => {
			const testCases = [
				{ error: new Error("Error msg"), expected: "Prefix: Error msg" },
				{ error: "string", expected: "Prefix: [Non-Error type thrown: string]" },
				{ error: 123, expected: "Prefix: [Non-Error type thrown: number]" },
				{ error: null, expected: "Prefix: [Non-Error type thrown: object]" },
			];

			for (const testCase of testCases) {
				const result = formatErrorWithPrefix("Prefix", testCase.error);
				assert.strictEqual(result, testCase.expected);
			}
		});

		test("should preserve error message with newlines", () => {
			const error = new Error("Line 1\nLine 2\nLine 3");
			const result = formatErrorWithPrefix("Multi-line error", error);
			assert.strictEqual(result, "Multi-line error: Line 1\nLine 2\nLine 3");
		});
	});
});
