import * as vscode from "vscode";

/**
 * Azure DevOps Authentication Provider using Microsoft Entra OAuth
 * Uses VS Code's built-in Microsoft authentication with the user_impersonation scope
 */
export class AzureDevOpsAuthProvider {
	private static readonly AZURE_DEVOPS_RESOURCE_ID = "499b84ac-1321-427f-aa17-267ca6975798";
	private static readonly SCOPES = [
		`${AzureDevOpsAuthProvider.AZURE_DEVOPS_RESOURCE_ID}/user_impersonation`,
	];

	private currentSession: vscode.AuthenticationSession | null = null;

	async signIn(): Promise<void> {
		const session = await vscode.authentication.getSession(
			"microsoft",
			AzureDevOpsAuthProvider.SCOPES,
			{ createIfNone: true },
		);

		if (!session) {
			throw new Error("Failed to obtain authentication session");
		}

		this.currentSession = session;
	}

	async signOut(): Promise<void> {
		// Clear the current session reference
		// Note: VS Code manages authentication sessions centrally
		// Users can fully sign out through VS Code's Accounts menu
		this.currentSession = null;
	}

	async getAccessToken(): Promise<string | null> {
		if (this.currentSession?.accessToken) {
			return this.currentSession.accessToken;
		}

		const session = await vscode.authentication.getSession(
			"microsoft",
			AzureDevOpsAuthProvider.SCOPES,
			{ createIfNone: false, silent: true },
		);

		if (session?.accessToken) {
			this.currentSession = session;
			return session.accessToken;
		}

		return null;
	}

	async isAuthenticated(): Promise<boolean> {
		const token = await this.getAccessToken();
		return token !== null;
	}
}
