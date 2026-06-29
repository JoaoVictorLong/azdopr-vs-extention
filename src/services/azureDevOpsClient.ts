import axios, { type AxiosInstance } from "axios";
import * as vscode from "vscode";
import type { AzureDevOpsAuthProvider } from "../auth/authProvider";
import { COMMENT_TYPE, THREAD_STATUS } from "../constants/azureDevOpsConstants";
import { Logger } from "../utils/logger";

const logger = Logger.getInstance();

export interface PullRequest {
	pullRequestId: number;
	title: string;
	description: string;
	createdBy: {
		displayName: string;
		uniqueName: string;
		imageUrl?: string;
	};
	creationDate: Date;
	status: string;
	repository: {
		id: string;
		name: string;
		project: {
			id: string;
			name: string;
		};
	};
	reviewers: Array<{
		id: string;
		displayName: string;
		uniqueName: string;
		imageUrl?: string;
		vote: number;
		isRequired?: boolean;
	}>;
	url: string;
	sourceRefName: string;
	targetRefName: string;
	isDraft: boolean;
	lastMergeSourceCommit?: {
		commitId: string;
	};
	lastMergeTargetCommit?: {
		commitId: string;
	};
}

export interface Project {
	id: string;
	name: string;
	description: string;
	state: string;
}

export interface Repository {
	id: string;
	name: string;
	project: {
		id: string;
		name: string;
	};
}

export interface PRIteration {
	id: number;
	description: string;
	author: {
		displayName: string;
		uniqueName: string;
	};
	createdDate: Date;
	updatedDate: Date;
}

export interface PRFileChange {
	changeId: number;
	changeType: string;
	item: {
		path: string;
		isFolder: boolean;
	};
	originalPath?: string;
}

export interface PRThread {
	id: number;
	publishedDate: Date;
	lastUpdatedDate: Date;
	comments: PRComment[];
	status: number;
	threadContext?: {
		filePath?: string;
		leftFileStart?: { line: number; offset: number };
		leftFileEnd?: { line: number; offset: number };
		rightFileStart?: { line: number; offset: number };
		rightFileEnd?: { line: number; offset: number };
	};
	properties?: Record<string, unknown>;
}

export interface PRComment {
	id: number;
	parentCommentId: number;
	author: {
		id: string;
		displayName: string;
		uniqueName: string;
		imageUrl?: string;
	};
	content: string;
	publishedDate: Date;
	lastUpdatedDate: Date;
	commentType: number;
}

/**
 * Internal interfaces for Azure DevOps API responses
 * These match the raw API response structure before transformation
 */
interface AzDOReviewer {
	id: string;
	displayName: string;
	uniqueName: string;
	imageUrl?: string;
	vote: number;
	isRequired?: boolean;
}

interface AzDOPullRequest {
	pullRequestId: number;
	title: string;
	description: string;
	createdBy: {
		displayName: string;
		uniqueName: string;
		imageUrl?: string;
	};
	creationDate: string;
	status: string;
	repository: {
		id: string;
		name: string;
		project: {
			id: string;
			name: string;
		};
	};
	reviewers: AzDOReviewer[];
	url: string;
	sourceRefName: string;
	targetRefName: string;
	isDraft: boolean;
	lastMergeSourceCommit?: {
		commitId: string;
	};
	lastMergeTargetCommit?: {
		commitId: string;
	};
}

interface AzDOIteration {
	id: number;
	description?: string;
	author: {
		displayName: string;
		uniqueName: string;
	};
	createdDate: string;
	updatedDate: string;
}

interface AzDOFileChange {
	changeId: number;
	changeType: string;
	item: {
		path: string;
		isFolder: boolean;
	};
	originalPath?: string;
}

interface AzDOComment {
	id: number;
	parentCommentId: number;
	author: {
		id: string;
		displayName: string;
		uniqueName: string;
		imageUrl?: string;
	};
	content: string;
	publishedDate: string;
	lastUpdatedDate: string;
	commentType: number;
}

interface AzDOThread {
	id: number;
	publishedDate: string;
	lastUpdatedDate: string;
	comments: AzDOComment[];
	status: number;
	threadContext?: {
		filePath?: string;
		leftFileStart?: { line: number; offset: number };
		leftFileEnd?: { line: number; offset: number };
		rightFileStart?: { line: number; offset: number };
		rightFileEnd?: { line: number; offset: number };
	};
	properties?: Record<string, unknown>;
}

interface AzDOThreadCreationRequest {
	comments: Array<{
		parentCommentId: number;
		content: string;
		commentType: number;
	}>;
	status: number;
	threadContext?: {
		filePath: string;
		leftFileStart?: {
			line: number;
			offset: number;
		};
		leftFileEnd?: {
			line: number;
			offset: number;
		};
		rightFileStart?: {
			line: number;
			offset: number;
		};
		rightFileEnd?: {
			line: number;
			offset: number;
		};
	};
	pullRequestThreadContext?: {
		iterationContext: {
			firstComparingIteration: number;
			secondComparingIteration: number;
		};
	};
	properties?: Record<string, unknown>;
}

interface CacheEntry<T> {
	data: T;
	timestamp: number;
	ttl: number;
}

/**
 * Azure DevOps REST API client
 *
 * ## Dual Caching Strategy
 *
 * This client uses TWO separate caching layers for different purposes:
 *
 * 1. **Short-term HTTP Response Cache** (this.cache - 1 minute TTL)
 *    - Caches raw API responses to prevent duplicate HTTP calls
 *    - Used by cachedFetch() method
 *    - Helps when same API endpoint is called multiple times in quick succession
 *    - Example: Multiple components requesting the same project list
 *
 * 2. **Medium-term PR Data Cache** (PRCacheService - 5 minute TTL)
 *    - Caches high-level PR data structures (details, iterations, files, threads)
 *    - Managed by PRCacheService singleton
 *    - Used by PullRequestViewerPanel to avoid re-fetching entire PR data
 *    - Example: User switches between PR files without re-fetching PR details
 *
 * **When to use which cache:**
 * - Use this.cache: For individual API calls (projects, repos, file content)
 * - Use PRCacheService: For complete PR data structures that are expensive to rebuild
 */
export class AzureDevOpsClient {
	private readonly axiosInstance: AxiosInstance;
	private organization: string = "";

	/**
	 * Short-term cache for individual API responses
	 * TTL: 1 minute (configurable per-call)
	 * Purpose: Prevent duplicate HTTP calls for the same endpoint
	 */
	private readonly cache = new Map<string, CacheEntry<unknown>>();

	constructor(private readonly authProvider: AzureDevOpsAuthProvider) {
		this.axiosInstance = axios.create({
			headers: {
				"Content-Type": "application/json",
			},
		});

		this.updateOrganization();
	}

	private updateOrganization(): void {
		const config = vscode.workspace.getConfiguration("azureDevOpsPRViewer");
		this.organization = config.get<string>("organization", "");
	}

	private async getAuthHeaders(): Promise<Record<string, string>> {
		const token = await this.authProvider.getAccessToken();
		if (!token) {
			throw new Error("Not authenticated");
		}
		const scheme = this.authProvider.getAuthScheme();
		if (scheme === "Basic") {
			const encoded = Buffer.from(`:${token}`).toString("base64");
			return { Authorization: `Basic ${encoded}` };
		}
		return {
			Authorization: `Bearer ${token}`,
		};
	}

	private getBaseUrl(): string {
		if (!this.organization) {
			throw new Error("Organization not configured");
		}
		return `https://dev.azure.com/${this.organization}`;
	}

	public getOrganizationUrl(): string {
		return this.getBaseUrl();
	}

	private async cachedFetch<T>(
		key: string,
		fetcher: () => Promise<T>,
		ttlMs: number = 60000, // 1 minute default
	): Promise<T> {
		const cached = this.cache.get(key);
		const now = Date.now();

		if (cached && now - cached.timestamp < cached.ttl) {
			return cached.data as T;
		}

		const data = await fetcher();
		this.cache.set(key, { data, timestamp: now, ttl: ttlMs });
		return data;
	}

	public clearCache(): void {
		this.cache.clear();
	}

	private mapComment(comment: AzDOComment): PRComment {
		return {
			id: comment.id,
			parentCommentId: comment.parentCommentId,
			author: comment.author,
			content: comment.content,
			publishedDate: new Date(comment.publishedDate),
			lastUpdatedDate: new Date(comment.lastUpdatedDate),
			commentType: comment.commentType,
		};
	}

	private mapThread(thread: AzDOThread): PRThread {
		return {
			id: thread.id,
			publishedDate: new Date(thread.publishedDate),
			lastUpdatedDate: new Date(thread.lastUpdatedDate),
			comments: (thread.comments || []).map((c) => this.mapComment(c)),
			status: thread.status,
			threadContext: thread.threadContext,
		};
	}

	private mapPullRequest(pr: AzDOPullRequest): PullRequest {
		return {
			pullRequestId: pr.pullRequestId,
			title: pr.title,
			description: pr.description || "",
			createdBy: pr.createdBy,
			creationDate: new Date(pr.creationDate),
			status: pr.status,
			repository: pr.repository,
			reviewers: (pr.reviewers || []).map((reviewer: AzDOReviewer) => ({
				id: reviewer.id,
				displayName: reviewer.displayName,
				uniqueName: reviewer.uniqueName,
				imageUrl: reviewer.imageUrl,
				vote: reviewer.vote,
				isRequired: reviewer.isRequired,
			})),
			url: pr.url
				? pr.url
						.replace("_apis/git/repositories", "_git")
						.replace("/pullRequests/", "/pullrequest/")
				: "",
			sourceRefName: pr.sourceRefName || "",
			targetRefName: pr.targetRefName || "",
			isDraft: pr.isDraft || false,
		};
	}

	async getProjects(): Promise<Project[]> {
		this.updateOrganization();
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/_apis/projects?api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });
		return response.data.value;
	}

	async getRepositories(projectId: string): Promise<Repository[]> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories?api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });
		return response.data.value;
	}

	async getPullRequests(projectId: string, repositoryId: string): Promise<PullRequest[]> {
		const headers = await this.getAuthHeaders();
		const config = vscode.workspace.getConfiguration("azureDevOpsPRViewer");
		const maxPRs = config.get<number>("maxPRsToFetch", 500);

		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests?searchCriteria.status=active&$top=${maxPRs}&api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });

		return response.data.value.map((pr: AzDOPullRequest) => this.mapPullRequest(pr));
	}

	async getAllPullRequests(): Promise<PullRequest[]> {
		return this.cachedFetch(
			"all-prs",
			async () => {
				this.updateOrganization();
				let projects = await this.getProjects();

				// Filter projects if configuration specifies included projects
				const config = vscode.workspace.getConfiguration("azureDevOpsPRViewer");
				const includedProjects = config.get<string[]>("includedProjects", []);

				if (includedProjects.length > 0) {
					projects = projects.filter((p) => includedProjects.includes(p.name));
					logger.info(
						`Filtered to ${projects.length} projects: ${projects.map((p) => p.name).join(", ")}`,
					);
				}

				// Fetch all repos for all projects in parallel (resilient to individual failures)
				const projectRepoResults = await Promise.allSettled(
					projects.map(async (project) => {
						const repos = await this.getRepositories(project.id);
						return { project, repos };
					}),
				);

				const projectRepos: Array<{ project: Project; repos: Repository[] }> = [];
				for (const result of projectRepoResults) {
					if (result.status === "fulfilled") {
						projectRepos.push(result.value);
					} else {
						logger.warn(`Failed to fetch repositories for a project: ${result.reason}`);
					}
				}

				// Fetch all PRs for all repos in parallel (resilient to individual failures)
				const allPRResults = await Promise.allSettled(
					projectRepos.flatMap(({ project, repos }) =>
						repos.map(async (repo) => {
							try {
								return await this.getPullRequests(project.id, repo.id);
							} catch (error) {
								logger.warn(
									`Failed to fetch PRs for ${project.name}/${repo.name}: ${error instanceof Error ? error.message : String(error)}`,
								);
								return [];
							}
						}),
					),
				);

				const allPRs: PullRequest[] = [];
				for (const result of allPRResults) {
					if (result.status === "fulfilled") {
						allPRs.push(...result.value);
					}
					// Rejections already logged in the inner catch
				}

				return allPRs;
			},
			30000, // 30 second cache
		);
	}

	async getPullRequestDetails(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
	): Promise<PullRequest> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}?api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });

		return this.mapPullRequest(response.data as AzDOPullRequest);
	}

	async getPullRequestIterations(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
	): Promise<PRIteration[]> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/iterations?api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });

		return response.data.value.map((iteration: AzDOIteration) => ({
			id: iteration.id,
			description: iteration.description || "",
			author: iteration.author,
			createdDate: new Date(iteration.createdDate),
			updatedDate: new Date(iteration.updatedDate),
		}));
	}

	async getPullRequestIterationChanges(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		iterationId: number,
	): Promise<PRFileChange[]> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/iterations/${iterationId}/changes?api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });

		const changes = response.data.changeEntries || [];
		return changes.map((change: AzDOFileChange) => ({
			changeId: change.changeId,
			changeType: change.changeType,
			item: change.item,
			originalPath: change.originalPath,
		}));
	}

	async getPullRequestThreads(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
	): Promise<PRThread[]> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/threads?api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });

		logger.debug(`API returned ${response.data.value.length} threads for PR ${pullRequestId}`);

		return response.data.value.map((thread: AzDOThread) => this.mapThread(thread));
	}

	/**
	 * Create a PR thread with a comment on a specific line
	 * @param side Which side of the diff: 'base' (left/original) or 'modified' (right/new)
	 */
	async createPRThread(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		filePath: string,
		lineNumber: number,
		commentText: string,
		side: "base" | "modified" = "modified",
	): Promise<PRThread> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/threads?api-version=7.0`;

		// Get the latest iteration to set the proper context
		const iterations = await this.getPullRequestIterations(projectId, repositoryId, pullRequestId);
		const latestIteration = iterations.length > 0 ? iterations.at(-1) : null;

		const requestBody: AzDOThreadCreationRequest = {
			comments: [
				{
					parentCommentId: 0,
					content: commentText,
					commentType: COMMENT_TYPE.TEXT,
				},
			],
			status: THREAD_STATUS.ACTIVE,
		};

		// Add thread context for line-level comments
		if (filePath) {
			requestBody.threadContext = {
				filePath: filePath,
			};

			if (side === "modified") {
				requestBody.threadContext.rightFileStart = { line: lineNumber, offset: 1 };
				requestBody.threadContext.rightFileEnd = { line: lineNumber, offset: 1 };
			} else {
				requestBody.threadContext.leftFileStart = { line: lineNumber, offset: 1 };
				requestBody.threadContext.leftFileEnd = { line: lineNumber, offset: 1 };
			}

			// Add pull request thread context if we have iteration information
			if (latestIteration) {
				requestBody.pullRequestThreadContext = {
					iterationContext: {
						firstComparingIteration: latestIteration.id,
						secondComparingIteration: latestIteration.id,
					},
				};
			}
		}

		const response = await this.axiosInstance.post(url, requestBody, {
			headers,
		});

		return this.mapThread(response.data as AzDOThread);
	}

	/** Create a file-level PR thread (not attached to a specific line) */
	async createFileLevelThread(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		filePath: string,
		commentText: string,
	): Promise<PRThread> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/threads?api-version=7.0`;

		// Get the latest iteration
		const iterations = await this.getPullRequestIterations(projectId, repositoryId, pullRequestId);
		const latestIteration = iterations.length > 0 ? iterations.at(-1) : null;

		const requestBody: AzDOThreadCreationRequest = {
			comments: [
				{
					parentCommentId: 0,
					content: commentText,
					commentType: COMMENT_TYPE.TEXT,
				},
			],
			status: THREAD_STATUS.ACTIVE,
			threadContext: {
				filePath: filePath,
				// No line numbers - this makes it a file-level comment
			},
		};

		// Add iteration context if available
		if (latestIteration) {
			requestBody.pullRequestThreadContext = {
				iterationContext: {
					firstComparingIteration: latestIteration.id,
					secondComparingIteration: latestIteration.id,
				},
			};
		}

		const response = await this.axiosInstance.post(url, requestBody, {
			headers,
		});

		return this.mapThread(response.data as AzDOThread);
	}

	/** Add a reply comment to an existing PR thread */
	async replyToPRThread(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		threadId: number,
		commentText: string,
	): Promise<PRComment> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/threads/${threadId}/comments?api-version=7.0`;

		const requestBody = {
			content: commentText,
			commentType: COMMENT_TYPE.TEXT,
		};

		const response = await this.axiosInstance.post(url, requestBody, {
			headers,
		});

		return this.mapComment(response.data as AzDOComment);
	}

	/** Update an existing comment in a PR thread */
	async updateComment(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		threadId: number,
		commentId: number,
		commentText: string,
	): Promise<PRComment> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/threads/${threadId}/comments/${commentId}?api-version=7.0`;

		const requestBody = {
			content: commentText,
		};

		const response = await this.axiosInstance.patch(url, requestBody, {
			headers,
		});

		return this.mapComment(response.data as AzDOComment);
	}

	/** Delete a comment from a PR thread */
	async deleteComment(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		threadId: number,
		commentId: number,
	): Promise<void> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/threads/${threadId}/comments/${commentId}?api-version=7.0`;

		await this.axiosInstance.delete(url, { headers });
	}

	/**
	 * Update PR thread status (resolve/unresolve)
	 * @param status 1 = Active, 2 = Fixed/Resolved, 4 = Closed
	 */
	async updateThreadStatus(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		threadId: number,
		status: number,
	): Promise<void> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/threads/${threadId}?api-version=7.0`;

		const requestBody = {
			status,
		};

		await this.axiosInstance.patch(url, requestBody, { headers });
	}

	/** Fetch file content from Azure DevOps repository at a specific version (commit SHA or branch name) */
	async getFileContent(
		projectId: string,
		repositoryId: string,
		path: string,
		version: string,
	): Promise<string> {
		try {
			const headers = await this.getAuthHeaders();
			const normalizedPath = path.startsWith("/") ? path.substring(1) : path;

			// Encode each segment separately to preserve forward slashes (handles paths with spaces)
			const encodedPath = normalizedPath
				.split("/")
				.map((segment) => encodeURIComponent(segment))
				.join("/");

			const versionType = /^[0-9a-f]{40}$/i.test(version) ? "commit" : "branch";

			const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/items?path=${encodedPath}&versionType=${versionType}&version=${version}&includeContent=true&api-version=7.0`;

			logger.debug("AzureDevOpsClient: Fetching file:", {
				originalPath: path,
				encodedPath,
				version,
				versionType,
				url,
			});

			const response = await this.axiosInstance.get(url, { headers });

			// API returns JSON with escaped newlines in the content field
			if (response.data && typeof response.data === "object" && "content" in response.data) {
				const content = response.data.content;

				if (content && typeof content === "string") {
					return content
						.replaceAll(String.raw`\n`, "\n")
						.replaceAll(String.raw`\r`, "\r")
						.replaceAll(String.raw`\t`, "\t");
				}

				if (content !== null && content !== undefined) {
					logger.warn(`Unexpected content type for file ${path}: ${typeof content}`);
				}
				return "";
			}

			if (typeof response.data === "string") {
				return response.data;
			}

			throw new Error(`Unexpected response format for file: ${path}`);
		} catch (error) {
			if (axios.isAxiosError(error)) {
				logger.error("AzureDevOpsClient: Error fetching file:", {
					path,
					status: error.response?.status,
					statusText: error.response?.statusText,
					data: error.response?.data,
				});
				if (error.response?.status === 404) {
					throw new Error(`File not found: ${path}`);
				}
			}
			throw error;
		}
	}

	/**
	 * Fetch file content with optional LFS resolution.
	 * When resolveLfs=true, LFS pointer files are resolved to their actual content.
	 */
	async getFileContentWithLfs(
		projectId: string,
		repositoryId: string,
		path: string,
		version: string,
		resolveLfs: boolean = false,
		downloadType: "text" | "binary" = "text",
	): Promise<string | Buffer> {
		try {
			const headers = await this.getAuthHeaders();
			const normalizedPath = path.startsWith("/") ? path.substring(1) : path;
			const encodedPath = normalizedPath
				.split("/")
				.map((segment) => encodeURIComponent(segment))
				.join("/");
			const versionType = /^[0-9a-f]{40}$/i.test(version) ? "commit" : "branch";

			const params = new URLSearchParams({
				path: encodedPath,
				versionType,
				version,
				includeContent: "true",
				"api-version": "7.1",
			});

			if (resolveLfs) {
				params.append("resolveLfs", "true");
			}

			const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/items?${params}`;

			logger.debug("AzureDevOpsClient: Fetching file with LFS:", {
				originalPath: path,
				encodedPath,
				version,
				versionType,
				resolveLfs,
				downloadType,
			});

			// Set response type based on download type
			const response = await this.axiosInstance.get(url, {
				headers,
				responseType: downloadType === "binary" ? "arraybuffer" : "json",
			});

			// Handle binary response
			if (downloadType === "binary") {
				// For binary downloads, Azure DevOps returns the raw binary data
				return Buffer.from(response.data);
			}

			// Handle text response (same logic as getFileContent)
			if (response.data && typeof response.data === "object" && "content" in response.data) {
				const content = response.data.content;

				if (content && typeof content === "string") {
					return content
						.replaceAll(String.raw`\n`, "\n")
						.replaceAll(String.raw`\r`, "\r")
						.replaceAll(String.raw`\t`, "\t");
				}

				if (content !== null && content !== undefined) {
					logger.warn(`Unexpected content type for file ${path}: ${typeof content}`);
				}
				return "";
			}

			// Fallback: if response is already a string
			if (typeof response.data === "string") {
				return response.data;
			}

			throw new Error(`Unexpected response format for file: ${path}`);
		} catch (error) {
			if (axios.isAxiosError(error)) {
				logger.error("AzureDevOpsClient: Error fetching file with LFS:", {
					path,
					resolveLfs,
					status: error.response?.status,
					statusText: error.response?.statusText,
					data: error.response?.data,
				});
				if (error.response?.status === 404) {
					throw new Error(`File not found: ${path}`);
				}
			}
			throw error;
		}
	}

	/**
	 * Create or update a reviewer vote on a pull request
	 * @param vote 10 = approved, 5 = approved with suggestions, 0 = no vote, -5 = waiting for author, -10 = rejected
	 */
	async createReviewerVote(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		reviewerId: string,
		vote: number,
	): Promise<AzDOReviewer> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/reviewers/${reviewerId}?api-version=7.0`;

		const requestBody = { vote };

		const response = await this.axiosInstance.put(url, requestBody, {
			headers,
		});

		return response.data;
	}

	/** Get the current authenticated user's identity */
	async getCurrentUser(): Promise<{
		id: string;
		displayName: string;
		uniqueName: string;
		imageUrl?: string;
	}> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/_apis/connectionData?api-version=7.0`;

		const response = await this.axiosInstance.get(url, { headers });
		const user = response.data.authenticatedUser;

		return {
			id: user.id,
			displayName: user.displayName,
			uniqueName: user.uniqueName,
			imageUrl: user.imageUrl,
		};
	}

	/** Fetch a profile image URL and convert it to a data URI (cached for 1 hour) */
	async getImageAsDataUri(imageUrl: string): Promise<string | undefined> {
		if (!imageUrl) {
			logger.debug("AzureDevOpsClient: No image URL provided");
			return undefined;
		}

		const cacheKey = `image:${imageUrl}`;
		const cached = this.cache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < cached.ttl) {
			logger.debug(`AzureDevOpsClient: Using cached image for ${imageUrl}`);
			return cached.data as string | undefined;
		}

		try {
			logger.debug(`AzureDevOpsClient: Fetching image from ${imageUrl}`);
			const headers = await this.getAuthHeaders();
			const response = await this.axiosInstance.get(imageUrl, {
				headers,
				responseType: "arraybuffer",
			});

			// Convert to base64
			const buffer = Buffer.from(response.data);
			const base64 = buffer.toString("base64");
			const contentType = response.headers["content-type"] || "image/png";
			const dataUri = `data:${contentType};base64,${base64}`;

			logger.debug(
				`[AzureDevOpsClient] Successfully converted image to data URI (${base64.length} bytes)`,
			);

			// Cache for 1 hour
			this.cache.set(cacheKey, {
				data: dataUri,
				timestamp: Date.now(),
				ttl: 60 * 60 * 1000,
			});

			return dataUri;
		} catch (error) {
			logger.error(`AzureDevOpsClient: Failed to fetch image from ${imageUrl}:`, error);
			return undefined;
		}
	}
}
