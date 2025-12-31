/**
 * Checkout Branch Command Handler
 *
 * Orchestrates the entire PR branch checkout flow with proper error handling
 * and user feedback. This command allows users to checkout a PR's source branch
 * locally when the workspace contains a matching repository.
 */

import * as vscode from "vscode";
import type { PullRequest } from "../services/azureDevOpsClient";
import type { GitService } from "../services/gitService";
import type { RepositoryMatchingService } from "../services/repositoryMatchingService";
import { Logger } from "../utils/logger";

const logger = Logger.getInstance();

/**
 * Handler for the checkout branch command
 */
export class CheckoutBranchCommandHandler {
	constructor(
		private readonly gitService: GitService,
		private readonly matchingService: RepositoryMatchingService,
	) {}

	/**
	 * Execute the checkout branch command for a pull request
	 *
	 * Flow:
	 * 1. Find matching local repository
	 * 2. Check for uncommitted changes
	 * 3. Extract branch name from PR
	 * 4. Fetch from remote if needed
	 * 5. Checkout branch
	 *
	 * @param pr - The pull request to checkout
	 */
	async execute(pr: PullRequest): Promise<void> {
		try {
			// Step 1: Find matching repository
			const match = this.matchingService.findMatchingRepository(pr);

			if (!match) {
				vscode.window.showWarningMessage(
					`Cannot checkout: No local Git repository found for ${pr.repository.name}. ` +
						`Ensure the repository is open in your workspace.`,
				);
				return;
			}

			// Step 2: Check for uncommitted changes
			if (this.gitService.hasUncommittedChanges(match.repository)) {
				const action = await vscode.window.showWarningMessage(
					`Cannot checkout: You have uncommitted changes in ${match.workspaceFolder.name}. ` +
						`Please commit or stash your changes first.`,
					"Show Changes",
				);

				if (action === "Show Changes") {
					// Open Source Control view
					await vscode.commands.executeCommand("workbench.view.scm");
				}
				return;
			}

			// Step 3: Extract branch name
			const branchName = this.extractBranchName(pr.sourceRefName);
			if (!branchName) {
				vscode.window.showErrorMessage(
					`Cannot checkout: Invalid branch reference "${pr.sourceRefName}"`,
				);
				return;
			}

			// Step 4 & 5: Execute checkout with progress
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Checking out ${branchName}...`,
					cancellable: false,
				},
				async (progress) => {
					// Check if branch exists locally
					const localBranch = await match.repository.getBranch(branchName);

					if (!localBranch) {
						// Fetch from remote first
						progress.report({ message: "Fetching from remote..." });
						await this.gitService.fetchBranch(match.repository, match.remoteName, branchName);
					}

					// Checkout
					progress.report({ message: "Checking out branch..." });
					await this.gitService.checkoutBranch(match.repository, branchName, match.remoteName);
				},
			);

			// Success
			vscode.window.showInformationMessage(
				`✓ Checked out ${branchName} in ${match.workspaceFolder.name}`,
			);
		} catch (error) {
			this.handleError(error, pr);
		}
	}

	/**
	 * Extract branch name from Azure DevOps ref name
	 *
	 * @param refName - Full ref name (e.g., "refs/heads/feature/branch")
	 * @returns Branch name without "refs/heads/" prefix, or null if invalid
	 */
	private extractBranchName(refName: string): string | null {
		if (!refName) {
			return null;
		}

		// Remove "refs/heads/" prefix
		const match = refName.match(/^refs\/heads\/(.+)$/);
		return match ? match[1] : null;
	}

	/**
	 * Handle errors during checkout with user-friendly messages
	 *
	 * @param error - The error that occurred
	 * @param pr - The pull request being checked out
	 */
	private handleError(error: unknown, pr: PullRequest): void {
		const message = error instanceof Error ? error.message : String(error);

		logger.error("Failed to checkout branch", error);

		// Specific error messages for common scenarios
		if (message.includes("not found")) {
			vscode.window.showErrorMessage(
				`Branch not found on remote. The branch "${pr.sourceRefName}" ` +
					`may have been deleted or renamed.`,
			);
		} else if (message.includes("permission") || message.includes("denied")) {
			vscode.window.showErrorMessage(
				`Permission denied. Check your Git credentials and remote access.`,
			);
		} else if (message.includes("shallow")) {
			vscode.window.showWarningMessage(
				`This is a shallow clone. Fetching may not work. ` +
					`Consider running: git fetch --unshallow`,
			);
		} else if (message.includes("network") || message.includes("connection")) {
			vscode.window.showErrorMessage(
				`Network error: ${message}. Check your internet connection and try again.`,
			);
		} else {
			vscode.window.showErrorMessage(`Failed to checkout branch: ${message}`);
		}
	}
}
