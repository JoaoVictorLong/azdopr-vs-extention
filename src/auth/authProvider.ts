import * as vscode from "vscode";

export class AzureDevOpsAuthProvider {
	private static readonly AZURE_DEVOPS_RESOURCE_ID = "499b84ac-1321-427f-aa17-267ca6975798";
	private static readonly SCOPES = [
		`${AzureDevOpsAuthProvider.AZURE_DEVOPS_RESOURCE_ID}/user_impersonation`,
	];

	private currentSession: vscode.AuthenticationSession | null = null;

	private getPatToken(): string {
		const config = vscode.workspace.getConfiguration("azureDevOpsPRViewer");
		return config.get<string>("patToken", "");
	}

	isPatAuth(): boolean {
		return this.getPatToken() !== "";
	}

	getAuthScheme(): "Basic" | "Bearer" {
		return this.isPatAuth() ? "Basic" : "Bearer";
	}

	async signIn(): Promise<void> {
		if (this.isPatAuth()) {
			return;
		}

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
		this.currentSession = null;
	}

	async getAccessToken(): Promise<string | null> {
		const pat = this.getPatToken();
		if (pat) {
			return pat;
		}

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
		if (this.isPatAuth()) {
			return true;
		}
		const token = await this.getAccessToken();
		return token !== null;
	}
}
