import axios, { type AxiosInstance } from "axios";
import * as vscode from "vscode";
import type { AzureDevOpsAuthProvider } from "../auth/authProvider";

export interface PullRequest {
	pullRequestId: number;
	title: string;
	description: string;
	createdBy: {
		displayName: string;
		uniqueName: string;
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
	status: string;
	threadContext?: {
		filePath?: string;
		leftFileStart?: { line: number; offset: number };
		leftFileEnd?: { line: number; offset: number };
		rightFileStart?: { line: number; offset: number };
		rightFileEnd?: { line: number; offset: number };
	};
	properties?: any;
}

export interface PRUpdate {
	updateId: number;
	createdDate: Date;
	createdBy: {
		displayName: string;
		uniqueName: string;
		imageUrl?: string;
	};
	description?: string;
}

export interface PRComment {
	id: number;
	parentCommentId: number;
	author: {
		displayName: string;
		uniqueName: string;
		imageUrl?: string;
	};
	content: string;
	publishedDate: Date;
	lastUpdatedDate: Date;
	commentType: string;
}

export interface PRBuildStatus {
	id: number;
	name: string;
	status: string;
	result?: string;
	url: string;
}

export class AzureDevOpsClient {
	private readonly axiosInstance: AxiosInstance;
	private organization: string = "";

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

	async getPullRequests(
		projectId: string,
		repositoryId: string,
	): Promise<PullRequest[]> {
		const headers = await this.getAuthHeaders();
		const config = vscode.workspace.getConfiguration("azureDevOpsPRViewer");
		const maxPRs = config.get<number>("maxPRsToFetch", 500);

		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests?searchCriteria.status=active&$top=${maxPRs}&api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });

		return response.data.value.map((pr: any) => ({
			pullRequestId: pr.pullRequestId,
			title: pr.title,
			description: pr.description || "",
			createdBy: pr.createdBy,
			creationDate: new Date(pr.creationDate),
			status: pr.status,
			repository: pr.repository,
			reviewers: (pr.reviewers || []).map((reviewer: any) => ({
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
		}));
	}

	async getAllPullRequests(): Promise<PullRequest[]> {
		this.updateOrganization();
		const projects = await this.getProjects();
		const allPRs: PullRequest[] = [];

		for (const project of projects) {
			const repos = await this.getRepositories(project.id);
			const prPromises = repos.map((repo) =>
				this.getPullRequests(project.id, repo.id),
			);
			const prResults = await Promise.all(prPromises);

			for (const prs of prResults) {
				allPRs.push(...prs);
			}
		}

		return allPRs;
	}

	async getPullRequestDetails(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
	): Promise<any> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}?api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });
		return response.data;
	}

	async getPullRequestIterations(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
	): Promise<PRIteration[]> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/iterations?api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });

		return response.data.value.map((iteration: any) => ({
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
		return changes.map((change: any) => ({
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

		console.log(
			`API returned ${response.data.value.length} threads for PR ${pullRequestId}`,
		);

		return response.data.value.map((thread: any) => {
			// Log thread details for debugging
			console.log(
				`Thread ${thread.id}: has ${thread.comments?.length || 0} comments, isDeleted: ${thread.isDeleted}, status: ${thread.status}`,
			);

			return {
				id: thread.id,
				publishedDate: new Date(thread.publishedDate),
				lastUpdatedDate: new Date(thread.lastUpdatedDate),
				comments: (thread.comments || []).map((comment: any) => ({
					id: comment.id,
					parentCommentId: comment.parentCommentId,
					author: comment.author,
					content: comment.content,
					publishedDate: new Date(comment.publishedDate),
					lastUpdatedDate: new Date(comment.lastUpdatedDate),
					commentType: comment.commentType,
				})),
				status: thread.status,
				threadContext: thread.threadContext,
			};
		});
	}

	async getPullRequestUpdates(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
	): Promise<PRUpdate[]> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/updates?api-version=7.0`;

		try {
			const response = await this.axiosInstance.get(url, { headers });
			console.log(
				`API returned ${response.data.value.length} updates for PR ${pullRequestId}`,
			);

			return response.data.value.map((update: any) => ({
				updateId: update.updateId,
				createdDate: new Date(update.createdDate),
				createdBy: update.createdBy,
				description: update.description,
			}));
		} catch (error) {
			console.error("Failed to fetch PR updates:", error);
			return [];
		}
	}

	async getPullRequestStatuses(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
	): Promise<PRBuildStatus[]> {
		try {
			const headers = await this.getAuthHeaders();
			const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/statuses?api-version=7.0`;
			const response = await this.axiosInstance.get(url, { headers });

			return response.data.value.map((status: any) => ({
				id: status.id,
				name: status.context?.name || status.description || "Build",
				status: status.state,
				result: status.state,
				url: status.targetUrl || "",
			}));
		} catch (error) {
			// Statuses endpoint might not be available for all organizations
			console.warn("Failed to fetch PR statuses:", error);
			return [];
		}
	}

	async getFileDiff(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		path: string,
	): Promise<string> {
		try {
			const headers = await this.getAuthHeaders();
			// Get the PR details to find the source and target commits
			const prDetails = await this.getPullRequestDetails(
				projectId,
				repositoryId,
				pullRequestId,
			);
			const sourceCommit = prDetails.lastMergeSourceCommit?.commitId;
			const targetCommit = prDetails.lastMergeTargetCommit?.commitId;

			if (!sourceCommit || !targetCommit) {
				return "Unable to fetch diff: commit information not available";
			}

			// Fetch the file content from both commits
			const sourceUrl = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent(path)}&versionType=commit&version=${sourceCommit}&api-version=7.0`;
			const targetUrl = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent(path)}&versionType=commit&version=${targetCommit}&api-version=7.0`;

			const [sourceResponse, targetResponse] = await Promise.allSettled([
				this.axiosInstance.get(sourceUrl, { headers }),
				this.axiosInstance.get(targetUrl, { headers }),
			]);

			const sourceContent =
				sourceResponse.status === "fulfilled" ? sourceResponse.value.data : "";
			const targetContent =
				targetResponse.status === "fulfilled" ? targetResponse.value.data : "";

			// Return a simple diff representation
			return `Source (${sourceCommit.substring(0, 7)}):\n${sourceContent}\n\nTarget (${targetCommit.substring(0, 7)}):\n${targetContent}`;
		} catch (error) {
			console.error("Failed to fetch file diff:", error);
			return "Unable to fetch diff";
		}
	}

	/**
	 * Create a PR thread with a comment
	 * @param projectId The project ID
	 * @param repositoryId The repository ID
	 * @param pullRequestId The pull request ID
	 * @param filePath The file path in the repository (e.g., "/src/file.ts")
	 * @param lineNumber The line number (1-based)
	 * @param commentText The comment text
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
		const iterations = await this.getPullRequestIterations(
			projectId,
			repositoryId,
			pullRequestId,
		);
		const latestIteration = iterations.length > 0 ? iterations.at(-1) : null;

		const requestBody: any = {
			comments: [
				{
					parentCommentId: 0,
					content: commentText,
					commentType: 1, // 1 = text comment
				},
			],
			status: 1, // 1 = active
		};

		// Add thread context for line-level comments
		if (filePath) {
			requestBody.threadContext = {
				filePath: filePath,
			};

			// Set the appropriate file position based on which side of the diff
			if (side === "modified") {
				// Comment on the modified (right) side - the new version
				requestBody.threadContext.rightFileStart = {
					line: lineNumber,
					offset: 1,
				};
				requestBody.threadContext.rightFileEnd = {
					line: lineNumber,
					offset: 1,
				};
			}

			if (side !== "modified") {
				// Comment on the base (left) side - the original version
				requestBody.threadContext.leftFileStart = {
					line: lineNumber,
					offset: 1,
				};
				requestBody.threadContext.leftFileEnd = {
					line: lineNumber,
					offset: 1,
				};
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

		// Map the response to our PRThread interface
		const thread = response.data;
		return {
			id: thread.id,
			publishedDate: new Date(thread.publishedDate),
			lastUpdatedDate: new Date(thread.lastUpdatedDate),
			comments: (thread.comments || []).map((comment: any) => ({
				id: comment.id,
				parentCommentId: comment.parentCommentId,
				author: comment.author,
				content: comment.content,
				publishedDate: new Date(comment.publishedDate),
				lastUpdatedDate: new Date(comment.lastUpdatedDate),
				commentType: comment.commentType,
			})),
			status: thread.status,
			threadContext: thread.threadContext,
		};
	}

	/**
	 * Add a reply comment to an existing PR thread
	 * @param projectId The project ID
	 * @param repositoryId The repository ID
	 * @param pullRequestId The pull request ID
	 * @param threadId The thread ID to reply to
	 * @param commentText The comment text
	 * @returns The created comment
	 */
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
			commentType: 1, // 1 = text comment
		};

		const response = await this.axiosInstance.post(url, requestBody, {
			headers,
		});

		// Map the response to our PRComment interface
		const comment = response.data;
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

	/**
	 * Fetch file content from Azure DevOps repository at a specific version
	 * @param projectId The project ID
	 * @param repositoryId The repository ID
	 * @param path The file path (e.g., "/src/file.ts")
	 * @param version The version (commit SHA, branch name, or tag)
	 * @returns The file content as a string
	 */
	async getFileContent(
		projectId: string,
		repositoryId: string,
		path: string,
		version: string,
	): Promise<string> {
		try {
			const headers = await this.getAuthHeaders();
			const encodedPath = encodeURIComponent(path);
			// Add includeContent=true to get the actual file content
			const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/items?path=${encodedPath}&version=${version}&includeContent=true&api-version=7.0`;

			const response = await this.axiosInstance.get(url, { headers });

			// The API returns JSON with a 'content' field containing the file content
			// The content has escaped newlines (\n) that need to be converted to actual newlines
			if (
				response.data &&
				typeof response.data === "object" &&
				"content" in response.data
			) {
				// Extract the content field and replace escaped newlines with actual newlines
				const content = response.data.content;

				// Check if content is a valid string
				if (content && typeof content === "string") {
					return content
						.replaceAll(String.raw`\n`, "\n")
						.replaceAll(String.raw`\r`, "\r")
						.replaceAll(String.raw`\t`, "\t");
				}

				// If content exists but is not a string, or is empty, return empty string
				if (content !== null && content !== undefined) {
					console.warn(`Unexpected content type for file ${path}:`, typeof content);
				}
				return "";
			}

			// Fallback: if response is already a string, return it
			if (typeof response.data === "string") {
				return response.data;
			}

			// If we get here, something unexpected happened
			throw new Error(`Unexpected response format for file: ${path}`);
		} catch (error) {
			if (axios.isAxiosError(error) && error.response?.status === 404) {
				throw new Error(`File not found: ${path}`);
			}
			throw error;
		}
	}

	/**
	 * Create or update a reviewer vote on a pull request
	 * @param projectId The project ID
	 * @param repositoryId The repository ID
	 * @param pullRequestId The pull request ID
	 * @param reviewerId The reviewer's ID
	 * @param vote The vote value: 10 = approved, 5 = approved with suggestions, 0 = no vote, -5 = waiting for author, -10 = rejected
	 * @returns The updated reviewer object
	 */
	async createReviewerVote(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		reviewerId: string,
		vote: number,
	): Promise<any> {
		const headers = await this.getAuthHeaders();
		const url = `${this.getBaseUrl()}/${projectId}/_apis/git/repositories/${repositoryId}/pullrequests/${pullRequestId}/reviewers/${reviewerId}?api-version=7.0`;

		const requestBody = {
			vote: vote,
		};

		const response = await this.axiosInstance.put(url, requestBody, {
			headers,
		});

		return response.data;
	}

	/**
	 * Get the current authenticated user's identity
	 * @returns The user's identity information including ID
	 */
	async getCurrentUser(): Promise<{
		id: string;
		displayName: string;
		uniqueName: string;
	}> {
		const headers = await this.getAuthHeaders();
		const url = "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.0";

		const response = await this.axiosInstance.get(url, { headers });

		return {
			id: response.data.id,
			displayName: response.data.displayName,
			uniqueName: response.data.emailAddress || response.data.publicAlias,
		};
	}
}
