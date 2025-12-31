/**
 * Git Service - Wrapper around VS Code's Git Extension API
 *
 * Provides a clean interface for Git operations needed for PR branch checkout.
 * Handles initialization, repository access, and common Git operations.
 */

import * as vscode from "vscode";
import { Logger } from "../utils/logger";

const logger = Logger.getInstance();

/**
 * Git API types from VS Code's built-in Git extension
 * Based on: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 */

export interface GitChange {
	readonly uri: vscode.Uri;
	readonly originalUri: vscode.Uri;
	readonly renameUri: vscode.Uri | undefined;
	readonly status: number;
}

export interface GitRemote {
	readonly name: string;
	readonly fetchUrl?: string;
	readonly pushUrl?: string;
	readonly isReadOnly: boolean;
}

export interface GitBranch {
	readonly name?: string;
	readonly commit?: string;
	readonly upstream?: {
		readonly name: string;
		readonly remote: string;
	};
	readonly type: number;
}

export interface GitRepositoryState {
	readonly HEAD: GitBranch | undefined;
	readonly refs: GitBranch[];
	readonly remotes: GitRemote[];
	readonly workingTreeChanges: GitChange[];
	readonly indexChanges: GitChange[];
}

export interface GitRepository {
	readonly rootUri: vscode.Uri;
	readonly state: GitRepositoryState;
	fetch(remote?: string, ref?: string, depth?: number): Promise<void>;
	checkout(ref: string): Promise<void>;
	getBranch(name: string): Promise<GitBranch | undefined>;
	createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
}

interface GitAPI {
	readonly repositories: GitRepository[];
	getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
	readonly enabled: boolean;
	getAPI(version: 1): GitAPI;
}

/**
 * Git Service for PR branch checkout operations
 */
export class GitService {
	private gitExtension?: GitExtension;
	private gitAPI?: GitAPI;

	/**
	 * Initialize the Git extension API
	 *
	 * @returns true if Git extension is available, false otherwise
	 */
	async initialize(): Promise<boolean> {
		try {
			const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");

			if (!extension) {
				logger.warn("Git extension not found - checkout features disabled");
				return false;
			}

			if (!extension.isActive) {
				await extension.activate();
			}

			this.gitExtension = extension.exports;

			if (!this.gitExtension.enabled) {
				logger.warn("Git extension is disabled - checkout features disabled");
				return false;
			}

			this.gitAPI = this.gitExtension.getAPI(1);
			logger.info("Git service initialized successfully");
			return true;
		} catch (error) {
			logger.error("Failed to initialize Git service", error);
			return false;
		}
	}

	/**
	 * Get the Git repository for a workspace folder
	 *
	 * @param workspaceFolder - Optional workspace folder to search in
	 * @returns Git repository or undefined if not found
	 */
	getRepository(workspaceFolder?: vscode.WorkspaceFolder): GitRepository | undefined {
		if (!this.gitAPI) {
			return undefined;
		}

		if (!workspaceFolder) {
			// Try first workspace folder
			const folders = vscode.workspace.workspaceFolders;
			if (!folders || folders.length === 0) {
				return undefined;
			}
			workspaceFolder = folders[0];
		}

		const repo = this.gitAPI.getRepository(workspaceFolder.uri);
		return repo ?? undefined;
	}

	/**
	 * Get all Git repositories in the workspace
	 *
	 * @returns Array of Git repositories
	 */
	getAllRepositories(): GitRepository[] {
		if (!this.gitAPI) {
			return [];
		}

		return this.gitAPI.repositories;
	}

	/**
	 * Check if a repository has uncommitted changes
	 *
	 * @param repo - The Git repository to check
	 * @returns true if there are uncommitted changes (working tree or index)
	 */
	hasUncommittedChanges(repo: GitRepository): boolean {
		const { workingTreeChanges, indexChanges } = repo.state;
		return workingTreeChanges.length > 0 || indexChanges.length > 0;
	}

	/**
	 * Fetch a branch from remote
	 *
	 * @param repo - The Git repository
	 * @param remoteName - The remote name (e.g., 'origin')
	 * @param branchName - The branch name to fetch
	 */
	async fetchBranch(repo: GitRepository, remoteName: string, branchName: string): Promise<void> {
		try {
			logger.info(`Fetching ${remoteName}/${branchName}`);
			await repo.fetch(remoteName, branchName);
		} catch (error) {
			logger.error(`Failed to fetch ${remoteName}/${branchName}`, error);
			throw error;
		}
	}

	/**
	 * Checkout a branch (or create tracking branch if doesn't exist)
	 *
	 * @param repo - The Git repository
	 * @param branchName - The branch name to checkout
	 * @param remoteName - Optional remote name for creating tracking branch
	 */
	async checkoutBranch(
		repo: GitRepository,
		branchName: string,
		remoteName?: string,
	): Promise<void> {
		try {
			const localBranch = await repo.getBranch(branchName);

			if (localBranch) {
				// Local branch exists, just checkout
				logger.info(`Checking out existing local branch: ${branchName}`);
				await repo.checkout(branchName);
			} else if (remoteName) {
				// Create tracking branch from remote
				logger.info(`Creating tracking branch: ${branchName} from ${remoteName}/${branchName}`);
				await repo.createBranch(branchName, true, `${remoteName}/${branchName}`);
			} else {
				throw new Error(`Branch ${branchName} not found locally and no remote specified`);
			}
		} catch (error) {
			logger.error(`Failed to checkout branch: ${branchName}`, error);
			throw error;
		}
	}
}
