import axios, { type AxiosInstance } from "axios";
import * as vscode from "vscode";
import type { AzureDevOpsAuthProvider } from "../auth/authProvider";
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
}

export interface Project {
	id: string;
	name: string;
	description: string;
	state: string;
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

export class AzureDevOpsClient {
	private readonly axiosInstance: AxiosInstance;
	private organization: string = "";
	private readonly cache = new Map<string, { data: unknown; timestamp: number; ttl: number }>();

	constructor(private readonly authProvider: AzureDevOpsAuthProvider) {
		this.axiosInstance = axios.create({
			headers: { "Content-Type": "application/json" },
		});
		this.updateOrganization();
	}

	private updateOrganization(): void {
		this.organization = vscode.workspace
			.getConfiguration("azureDevOpsPRViewer")
			.get<string>("organization", "");
	}

	private async getAuthHeaders(): Promise<Record<string, string>> {
		const token = await this.authProvider.getAccessToken();
		if (!token) throw new Error("Not authenticated");
		const scheme = this.authProvider.getAuthScheme();
		if (scheme === "Basic") {
			const encoded = Buffer.from(`:${token}`).toString("base64");
			return { Authorization: `Basic ${encoded}` };
		}
		return { Authorization: `Bearer ${token}` };
	}

	private getBaseUrl(): string {
		if (!this.organization) throw new Error("Organization not configured");
		return `https://dev.azure.com/${this.organization.replace(/\/+$/, "")}`;
	}

	public clearCache(): void {
		this.cache.clear();
	}

	private async cachedFetch<T>(
		key: string,
		fetcher: () => Promise<T>,
		ttlMs: number = 60000,
	): Promise<T> {
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.timestamp < cached.ttl) {
			return cached.data as T;
		}
		const data = await fetcher();
		this.cache.set(key, { data, timestamp: Date.now(), ttl: ttlMs });
		return data;
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
			reviewers: (pr.reviewers || []).map((r) => ({
				id: r.id,
				displayName: r.displayName,
				uniqueName: r.uniqueName,
				imageUrl: r.imageUrl,
				vote: r.vote,
				isRequired: r.isRequired,
			})),
			url: pr.url
				? pr.url.replace("_apis/git/repositories", "_git").replace("/pullRequests/", "/pullrequest/")
				: "",
			sourceRefName: pr.sourceRefName || "",
			targetRefName: pr.targetRefName || "",
			isDraft: pr.isDraft || false,
		};
	}

	async getAllPullRequests(): Promise<PullRequest[]> {
		this.updateOrganization();
		const headers = await this.getAuthHeaders();
		const config = vscode.workspace.getConfiguration("azureDevOpsPRViewer");
		const maxPRs = config.get<number>("maxPRsToFetch", 200);

		const url = `${this.getBaseUrl()}/_apis/git/pullRequests?searchCriteria.status=active&$top=${maxPRs}&api-version=7.0`;
		const response = await this.axiosInstance.get(url, { headers });

		return (response.data.value || []).map((pr: AzDOPullRequest) => this.mapPullRequest(pr));
	}

	async voteOnPullRequest(pr: PullRequest, vote: number): Promise<void> {
		this.updateOrganization();
		const headers = await this.getAuthHeaders();
		const user = await this.getCurrentUser();
		const baseUrl = this.getBaseUrl();
		const url = `${baseUrl}/${pr.repository.project.name}/_apis/git/repositories/${pr.repository.name}/pullRequests/${pr.pullRequestId}/reviewers/${user.id}?api-version=7.0`;
		await this.axiosInstance.put(url, { vote }, { headers });
	}

	async getCurrentUser(): Promise<{
		id: string;
		displayName: string;
		uniqueName: string;
		imageUrl?: string;
	}> {
		const headers = await this.getAuthHeaders();

		const strategies: (() => Promise<{
			id: string;
			displayName: string;
			uniqueName: string;
			imageUrl?: string;
		}>)[] = [
			async () => {
				const url = `${this.getBaseUrl()}/_apis/ConnectionData?api-version=7.0-preview`;
				const res = await this.axiosInstance.get(url, { headers });
				const u = res.data.authenticatedUser;
				return { id: u.id, displayName: u.displayName, uniqueName: u.uniqueName, imageUrl: u.imageUrl };
			},
			async () => {
				const org = this.organization.replace(/\/+$/, "");
				const url = `https://vssps.dev.azure.com/${org}/_apis/profile/profiles/me?api-version=7.0`;
				const res = await this.axiosInstance.get(url, { headers });
				const uniqueName = res.data.emailAddress || res.data.publicAlias;
				return {
					id: res.data.id,
					displayName: res.data.displayName,
					uniqueName,
					imageUrl: res.data.coreAttributes?.Avatar?.value?.value,
				};
			},
			async () => {
				const org = this.organization.replace(/\/+$/, "");
				const profile = await this.axiosInstance.get(
					`https://vssps.dev.azure.com/${org}/_apis/profile/profiles/me?api-version=7.0`,
					{ headers },
				);
				const email = profile.data.emailAddress || profile.data.publicAlias;
				const identities = await this.axiosInstance.get(
					`https://vssps.dev.azure.com/${org}/_apis/identities?searchFilter=General&filterValue=${encodeURIComponent(email)}&api-version=7.0`,
					{ headers },
				);
				const identity = identities.data.value?.[0];
				if (!identity) throw new Error("Identity not found");
				return {
					id: identity.id,
					displayName: identity.displayName || profile.data.displayName,
					uniqueName: identity.providerDisplayName || email,
					imageUrl: profile.data.coreAttributes?.Avatar?.value?.value,
				};
			},
		];

		for (const strategy of strategies) {
			try {
				return await strategy();
			} catch {
				continue;
			}
		}
		throw new Error("Failed to fetch current user from all endpoints");
	}
}
