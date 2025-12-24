/**
 * Azure DevOps Git Remote URL Parser
 *
 * Parses Azure DevOps Git remote URLs to extract organization, project, and repository information.
 * Supports both HTTPS and SSH URL formats for dev.azure.com and legacy visualstudio.com domains.
 */

export interface ParsedAzureDevOpsUrl {
	organization: string;
	project: string;
	repository: string;
	isAzureDevOps: boolean;
}

export class AzureDevOpsUrlParser {
	/**
	 * Parse an Azure DevOps Git remote URL
	 *
	 * Supported formats:
	 * 1. HTTPS dev.azure.com: https://dev.azure.com/{org}/{project}/_git/{repo}
	 * 2. HTTPS visualstudio.com: https://{org}.visualstudio.com/{project}/_git/{repo}
	 * 3. SSH dev.azure.com: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
	 * 4. SSH visualstudio.com: {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
	 *
	 * @param remoteUrl - The Git remote URL to parse
	 * @returns Parsed Azure DevOps metadata, or null if not an Azure DevOps URL
	 */
	static parse(remoteUrl: string): ParsedAzureDevOpsUrl | null {
		if (!remoteUrl) {
			return null;
		}

		// Try HTTPS dev.azure.com format
		// https://dev.azure.com/{org}/{project}/_git/{repo}
		// https://{user}@dev.azure.com/{org}/{project}/_git/{repo}
		const httpsDevMatch = remoteUrl.match(
			/https:\/\/(?:.*@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+)/,
		);
		// https://dev.azure.com/{org}/{project}/_git/{repo}
		// https://{user}@dev.azure.com/{org}/{project}/_git/{repo}
		const httpsDevMatch = remoteUrl.match(
			/https:\/\/(?:.*@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+)/,
		);
		if (httpsDevMatch) {
			return {
				organization: httpsDevMatch[1],
				project: httpsDevMatch[2],
				repository: AzureDevOpsUrlParser.normalizeRepoName(httpsDevMatch[3]),
				isAzureDevOps: true,
			};
		}

		// Try HTTPS visualstudio.com format
		// https://{org}.visualstudio.com/{project}/_git/{repo}
		// https://{org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}
		const httpsVsMatch = remoteUrl.match(
			/https:\/\/([^.]+)\.visualstudio\.com(?:\/DefaultCollection)?\/([^/]+)\/_git\/([^/\s]+)/,
		);
		if (httpsVsMatch) {
			return {
				organization: httpsVsMatch[1],
				project: httpsVsMatch[2],
				repository: AzureDevOpsUrlParser.normalizeRepoName(httpsVsMatch[3]),
				isAzureDevOps: true,
			};
		}

		// Try SSH dev.azure.com format
		// git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
		const sshDevMatch = remoteUrl.match(/git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+)/);
		if (sshDevMatch) {
			return {
				organization: sshDevMatch[1],
				project: sshDevMatch[2],
				repository: AzureDevOpsUrlParser.normalizeRepoName(sshDevMatch[3]),
				isAzureDevOps: true,
			};
		}

		// Try SSH visualstudio.com format
		// {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
		const sshVsMatch = remoteUrl.match(
			/([^@]+)@vs-ssh\.visualstudio\.com:v3\/\1\/([^/]+)\/([^/\s]+)/,
		);
		if (sshVsMatch) {
			return {
				organization: sshVsMatch[1],
				project: sshVsMatch[2],
				repository: AzureDevOpsUrlParser.normalizeRepoName(sshVsMatch[3]),
				isAzureDevOps: true,
			};
		}

		return null;
	}

	/**
	 * Normalize repository name by removing .git suffix if present
	 *
	 * @param name - The repository name to normalize
	 * @returns Normalized repository name
	 */
	static normalizeRepoName(name: string): string {
		return name.replace(/\.git$/, "");
	}
}
