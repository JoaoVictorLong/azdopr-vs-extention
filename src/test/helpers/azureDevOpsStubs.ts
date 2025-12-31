import axios, { type AxiosInstance, type AxiosResponse } from "axios";
import * as sinon from "sinon";

/**
 * Create a stubbed Axios instance for mocking Azure DevOps API calls
 */
export function createAxiosStub(): {
	instance: Partial<AxiosInstance>;
	get: sinon.SinonStub;
	post: sinon.SinonStub;
	patch: sinon.SinonStub;
	delete: sinon.SinonStub;
	put: sinon.SinonStub;
} {
	const getStub = sinon.stub();
	const postStub = sinon.stub();
	const patchStub = sinon.stub();
	const deleteStub = sinon.stub();
	const putStub = sinon.stub();

	const instance: Partial<AxiosInstance> = {
		get: getStub,
		post: postStub,
		patch: patchStub,
		delete: deleteStub,
		put: putStub,
		interceptors: {
			request: {
				use: sinon.stub(),
				eject: sinon.stub(),
				clear: sinon.stub(),
			},
			response: {
				use: sinon.stub(),
				eject: sinon.stub(),
				clear: sinon.stub(),
			},
			// biome-ignore lint/suspicious/noExplicitAny: Partial mock for testing
		} as any,
	};

	return {
		instance,
		get: getStub,
		post: postStub,
		patch: patchStub,
		delete: deleteStub,
		put: putStub,
	};
}

/**
 * Stub the axios.create method to return a mock instance
 */
export function stubAxiosCreate(): {
	createStub: sinon.SinonStub;
	axiosStubs: ReturnType<typeof createAxiosStub>;
} {
	const axiosStubs = createAxiosStub();
	const createStub = sinon.stub(axios, "create").returns(axiosStubs.instance as AxiosInstance);

	return { createStub, axiosStubs };
}

/**
 * Reset axios create stub
 */
export function resetAxiosStub(createStub: sinon.SinonStub) {
	createStub.restore();
}

/**
 * Helper to stub specific Azure DevOps API endpoints with responses
 */
export function stubAzureDevOpsEndpoints(
	axiosStubs: ReturnType<typeof createAxiosStub>,
	endpoints: Record<
		string,
		// biome-ignore lint/suspicious/noExplicitAny: Test helper accepts any response type
		{ method: "get" | "post" | "patch" | "delete"; response: any; status?: number }
	>,
) {
	for (const [url, config] of Object.entries(endpoints)) {
		const response: AxiosResponse = {
			data: config.response,
			status: config.status || 200,
			statusText: "OK",
			headers: {},
			// biome-ignore lint/suspicious/noExplicitAny: Axios config type requires any for headers
			config: { headers: {} as any },
		};

		switch (config.method) {
			case "get":
				axiosStubs.get.withArgs(url).resolves(response);
				break;
			case "post":
				axiosStubs.post.withArgs(url).resolves(response);
				break;
			case "patch":
				axiosStubs.patch.withArgs(url).resolves(response);
				break;
			case "delete":
				axiosStubs.delete.withArgs(url).resolves(response);
				break;
		}
	}
}

/**
 * Helper to stub Azure DevOps API errors
 */
export function stubAzureDevOpsError(
	axiosStubs: ReturnType<typeof createAxiosStub>,
	url: string,
	method: "get" | "post" | "patch" | "delete",
	statusCode: number,
	message = "Error",
) {
	// biome-ignore lint/suspicious/noExplicitAny: Need to add custom properties to Error object
	const error: any = new Error(message);
	error.response = {
		data: { message, typeKey: getErrorType(statusCode) },
		status: statusCode,
		statusText: getStatusText(statusCode),
		headers: {},
		config: {},
	};
	error.isAxiosError = true;

	switch (method) {
		case "get":
			axiosStubs.get.withArgs(url).rejects(error);
			break;
		case "post":
			axiosStubs.post.withArgs(url).rejects(error);
			break;
		case "patch":
			axiosStubs.patch.withArgs(url).rejects(error);
			break;
		case "delete":
			axiosStubs.delete.withArgs(url).rejects(error);
			break;
	}
}

/**
 * Create a mock successful response
 */
export function createMockResponse<T>(data: T, status = 200): AxiosResponse<T> {
	return {
		data,
		status,
		statusText: getStatusText(status),
		headers: {},
		// biome-ignore lint/suspicious/noExplicitAny: Axios config type requires any for headers
		config: { headers: {} as any },
	};
}

/**
 * Create a mock error response
 */
export function createMockError(statusCode: number, message = "Error"): Error {
	// biome-ignore lint/suspicious/noExplicitAny: Need to add custom properties to Error object
	const error: any = new Error(message);
	error.response = {
		data: { message, typeKey: getErrorType(statusCode) },
		status: statusCode,
		statusText: getStatusText(statusCode),
		headers: {},
		config: {},
	};
	error.isAxiosError = true;
	return error;
}

/**
 * Get error type key based on status code
 */
function getErrorType(statusCode: number): string {
	switch (statusCode) {
		case 400:
			return "BadRequest";
		case 401:
			return "Unauthorized";
		case 403:
			return "Forbidden";
		case 404:
			return "NotFound";
		case 500:
			return "InternalServerError";
		default:
			return "UnknownError";
	}
}

/**
 * Get status text based on status code
 */
function getStatusText(statusCode: number): string {
	switch (statusCode) {
		case 200:
			return "OK";
		case 201:
			return "Created";
		case 204:
			return "No Content";
		case 400:
			return "Bad Request";
		case 401:
			return "Unauthorized";
		case 403:
			return "Forbidden";
		case 404:
			return "Not Found";
		case 500:
			return "Internal Server Error";
		default:
			return "Unknown";
	}
}
