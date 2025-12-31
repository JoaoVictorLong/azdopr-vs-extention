/**
 * Central export hub for all test helpers
 */

// Assertions
export {
	assertArrayContains,
	assertArrayDoesNotContain,
	assertDatesEqual,
	assertDefined,
	assertDoesNotMatch,
	assertHasProperty,
	assertInRange,
	assertMatches,
	assertRejectsWithMessage,
	assertThrowsWithMessage,
} from "./assertions";

// Azure DevOps Stubs
export {
	createAxiosStub,
	createMockError,
	createMockResponse,
	resetAxiosStub,
	stubAxiosCreate,
	stubAzureDevOpsEndpoints,
	stubAzureDevOpsError,
} from "./azureDevOpsStubs";

// Time Helpers
export {
	advanceTime,
	advanceTimeInSteps,
	createTestClock,
	flushTimers,
	TestClock,
	withFakeTimers,
} from "./timeHelpers";
// VS Code Stubs
export {
	createMockAuthSession,
	createMockCommentThread,
	createMockConfiguration,
	createMockExtensionContext,
	createMockTextDocument,
	createVSCodeStubs,
	resetVSCodeStubs,
} from "./vscodeStubs";
