/**
 * Central export hub for all test fixtures
 */

// API Responses
export {
	create401Response,
	create404Response,
	create500Response,
	createAxiosResponse,
	createNetworkError,
	mockAzDOPRListResponse,
	mockAzDOProjectsResponse,
	mockAzDORepositoriesResponse,
	mockAzDOThreadsResponse,
	mockFileContentResponse,
	mockLfsPointerResponse,
} from "./apiResponses";

// Comments and Threads
export {
	createActiveThreadWithContext,
	createMockComment,
	createMockThread,
	createResolvedThread,
	createThreadWithComments,
	mockComment,
	mockReplyComment,
	mockResolvedThread,
	mockSystemComment,
	mockThread,
	mockThreadWithoutContext,
} from "./comments";
// LFS Files
export {
	createLfsPointer,
	getExpectedOid,
	getExpectedSize,
	invalidLfsPointerExtraLines,
	invalidLfsPointerMalformedOid,
	invalidLfsPointerMalformedSize,
	invalidLfsPointerMissingOid,
	invalidLfsPointerMissingSize,
	invalidLfsPointerWrongVersion,
	mockBinaryBuffer,
	mockJpegBuffer,
	mockLfsPointer,
	mockLfsPointer2,
	mockPdfBuffer,
	mockPngBuffer,
	mockTextFileContent,
} from "./lfsFiles";
// Pull Requests
export {
	createAbandonedPR,
	createCompletedPR,
	createDraftPR,
	createMockFileChange,
	createMockIteration,
	createMockPR,
	createMockProject,
	createMockRepository,
	mockPRFileChange,
	mockPRFileChangeAdd,
	mockPRFileChangeDelete,
	mockPRFileChangeRename,
	mockPRIteration,
	mockProject,
	mockPullRequest,
	mockRepository,
} from "./pullRequests";
