export interface ParsedAzureDevOpsUrl {
	organization: string;
	project: string;
	repository: string;
	isAzureDevOps: boolean;
}

/**
 * Normalize repository name by removing .git suffix if present
 */
export function normalizeRepoName(name: string): string {
	return name.replace(/\.git$/, "");
}

/**
 * Parse an Azure DevOps Git remote URL
 *
 * Supported formats:
 * 1. HTTPS dev.azure.com: https://dev.azure.com/{org}/{project}/_git/{repo}
 * 2. HTTPS visualstudio.com: https://{org}.visualstudio.com/{project}/_git/{repo}
 * 3. SSH dev.azure.com: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 * 4. SSH visualstudio.com: {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
 */
export function parseAzureDevOpsUrl(remoteUrl: string): ParsedAzureDevOpsUrl | null {
	if (!remoteUrl) {
		return null;
	}

	const httpsDevMatch = remoteUrl.match(
		/https:\/\/(?:.*@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+)/,
	);
	if (httpsDevMatch) {
		return {
			organization: httpsDevMatch[1],
			project: httpsDevMatch[2],
			repository: normalizeRepoName(httpsDevMatch[3]),
			isAzureDevOps: true,
		};
	}

	const httpsVsMatch = remoteUrl.match(
		/https:\/\/([^.]+)\.visualstudio\.com(?:\/DefaultCollection)?\/([^/]+)\/_git\/([^/\s]+)/,
	);
	if (httpsVsMatch) {
		return {
			organization: httpsVsMatch[1],
			project: httpsVsMatch[2],
			repository: normalizeRepoName(httpsVsMatch[3]),
			isAzureDevOps: true,
		};
	}

	const sshDevMatch = remoteUrl.match(/git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+)/);
	if (sshDevMatch) {
		return {
			organization: sshDevMatch[1],
			project: sshDevMatch[2],
			repository: normalizeRepoName(sshDevMatch[3]),
			isAzureDevOps: true,
		};
	}

	const sshVsMatch = remoteUrl.match(
		/([^@]+)@vs-ssh\.visualstudio\.com:v3\/\1\/([^/]+)\/([^/\s]+)/,
	);
	if (sshVsMatch) {
		return {
			organization: sshVsMatch[1],
			project: sshVsMatch[2],
			repository: normalizeRepoName(sshVsMatch[3]),
			isAzureDevOps: true,
		};
	}

	return null;
}
