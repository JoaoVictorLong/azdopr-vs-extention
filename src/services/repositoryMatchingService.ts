/**
 * Repository Matching Service
 *
 * Matches local Git repositories with Azure DevOps PR repository metadata.
 * Uses remote URL parsing to determine if a PR belongs to a local repository.
 */

import * as vscode from "vscode";
import { AzureDevOpsUrlParser } from "../utils/azureDevOpsUrlParser";
import { Logger } from "../utils/logger";
import type { PullRequest } from "./azureDevOpsClient";
import type { GitRemote, GitRepository, GitService } from "./gitService";

const logger = Logger.getInstance();

/**
 * Result of matching a PR with a local repository
 */
export interface RepositoryMatch {
	repository: GitRepository;
	workspaceFolder: vscode.WorkspaceFolder;
	matchedRemote: GitRemote;
	remoteName: string;
	confidence: "exact" | "partial" | "none";
}

/**
 * Service for matching PRs with local Git repositories
 */
export class RepositoryMatchingService {
	constructor(
		private readonly gitService: GitService,
		private readonly configuredOrg: string,
	) {}

	/**
	 * Find a matching local repository for a pull request
	 *
	 * @param pr - The pull request to match
	 * @returns Repository match info, or null if no match found
	 */
	findMatchingRepository(pr: PullRequest): RepositoryMatch | null {
		const repos = this.gitService.getAllRepositories();

		for (const repo of repos) {
			const match = this.matchRepository(repo, pr);
			if (match && match.confidence !== "none") {
				return match;
			}
		}

		return null;
	}

	/**
	 * Match a single repository against a PR
	 *
	 * @param repo - The Git repository to check
	 * @param pr - The pull request to match
	 * @returns Repository match info, or null if no match
	 */
	private matchRepository(repo: GitRepository, pr: PullRequest): RepositoryMatch | null {
		const remotes = repo.state.remotes;

		// Prefer 'origin', then 'upstream', then try others
		const remoteOrder = [
			"origin",
			"upstream",
			...remotes.filter((r) => r.name !== "origin" && r.name !== "upstream").map((r) => r.name),
		];

		for (const remoteName of remoteOrder) {
			const remote = remotes.find((r) => r.name === remoteName);
			if (!remote?.fetchUrl) {
				continue;
			}

			const parsed = AzureDevOpsUrlParser.parse(remote.fetchUrl);
			if (!parsed) {
				continue;
			}

			// Check if it matches the PR's repository
			const confidence = this.calculateMatchConfidence(parsed, pr);

			if (confidence !== "none") {
				logger.debug(
					`Found ${confidence} match: ${parsed.organization}/${parsed.project}/${parsed.repository}`,
				);

				return {
					repository: repo,
					workspaceFolder: this.getWorkspaceFolderForRepo(repo),
					matchedRemote: remote,
					remoteName,
					confidence,
				};
			}
		}

		return null;
	}

	/**
	 * Calculate match confidence level
	 *
	 * @param parsed - Parsed Azure DevOps URL metadata
	 * @param pr - The pull request to match
	 * @returns Confidence level
	 */
	private calculateMatchConfidence(
		parsed: ReturnType<typeof AzureDevOpsUrlParser.parse>,
		pr: PullRequest,
	): "exact" | "partial" | "none" {
		if (!parsed) {
			return "none";
		}

		const normalizedRemoteRepo = AzureDevOpsUrlParser.normalizeRepoName(parsed.repository);
		const normalizedPrRepo = AzureDevOpsUrlParser.normalizeRepoName(pr.repository.name);

		// Exact match: org + project + repo all match
		if (
			parsed.organization === this.configuredOrg &&
			parsed.project === pr.repository.project.name &&
			normalizedRemoteRepo === normalizedPrRepo
		) {
			return "exact";
		}

		// Partial match: same repo name, but different org/project
		// (useful for forks or multi-org scenarios)
		if (normalizedRemoteRepo === normalizedPrRepo) {
			return "partial";
		}

		return "none";
	}

	/**
	 * Get the workspace folder containing a repository
	 *
	 * @param repo - The Git repository
	 * @returns The workspace folder, or first folder as fallback
	 */
	private getWorkspaceFolderForRepo(repo: GitRepository): vscode.WorkspaceFolder {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const found = folders.find((f) => repo.rootUri.fsPath.startsWith(f.uri.fsPath));
		return found ?? folders[0];
	}
}
