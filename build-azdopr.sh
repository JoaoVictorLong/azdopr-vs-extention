#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/JoaoVictorLong/azdopr-vs-extention.git"
TARGET_DIR="${1:-./azdopr-vs-extention}"

echo "==> Cloning fork..."
git clone "$REPO_URL" "$TARGET_DIR"
cd "$TARGET_DIR"

echo "==> Installing dependencies..."
npm install

echo "==> Applying PAT authentication modifications..."

cat > src/auth/authProvider.ts << 'ENDOFFILE'
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
ENDOFFILE

python3 << 'ENDOFFILE'
import sys

path = "src/services/azureDevOpsClient.ts"
with open(path) as f:
    content = f.read()

old = '\tprivate async getAuthHeaders(): Promise<Record<string, string>> {\n\t\tconst token = await this.authProvider.getAccessToken();\n\t\tif (!token) {\n\t\t\tthrow new Error("Not authenticated");\n\t\t}\n\t\treturn {\n\t\t\tAuthorization: `Bearer ${token}`,\n\t\t};\n\t}'

new = '\tprivate async getAuthHeaders(): Promise<Record<string, string>> {\n\t\tconst token = await this.authProvider.getAccessToken();\n\t\tif (!token) {\n\t\t\tthrow new Error("Not authenticated");\n\t\t}\n\t\tconst scheme = this.authProvider.getAuthScheme();\n\t\tif (scheme === "Basic") {\n\t\t\tconst encoded = Buffer.from(`:${token}`).toString("base64");\n\t\t\treturn { Authorization: `Basic ${encoded}` };\n\t\t}\n\t\treturn {\n\t\t\tAuthorization: `Bearer ${token}`,\n\t\t};\n\t}'

assert old in content, "getAuthHeaders pattern not found"
content = content.replace(old, new)
with open(path, "w") as f:
    f.write(content)
print("  + azureDevOpsClient.ts: updated getAuthHeaders")

path = "src/extension.ts"
with open(path) as f:
    content = f.read()

old = '\tauthProvider = new AzureDevOpsAuthProvider();\n\n\tconst isAuthenticated = await authProvider.isAuthenticated();\n\tawait vscode.commands.executeCommand(\n\t\t"setContext",\n\t\t"azureDevOpsPRs:authenticated",\n\t\tisAuthenticated,\n\t);\n\n\tazureDevOpsClient = new AzureDevOpsClient(authProvider);'

new = '\tauthProvider = new AzureDevOpsAuthProvider();\n\n\tconst isAuthenticated = await authProvider.isAuthenticated();\n\tawait vscode.commands.executeCommand(\n\t\t"setContext",\n\t\t"azureDevOpsPRs:authenticated",\n\t\tisAuthenticated,\n\t);\n\n\tif (authProvider.isPatAuth()) {\n\t\tlogger.info("PAT authentication configured");\n\t}\n\n\tazureDevOpsClient = new AzureDevOpsClient(authProvider);'

assert old in content, "activation block not found"
content = content.replace(old, new)

old2 = '\t\tvscode.authentication.onDidChangeSessions(async (e) => {\n\t\t\tif (e.provider.id === "microsoft") {\n\t\t\t\tconst isAuthenticated = await authProvider.isAuthenticated();\n\t\t\t\tawait vscode.commands.executeCommand(\n\t\t\t\t\t"setContext",\n\t\t\t\t\t"azureDevOpsPRs:authenticated",\n\t\t\t\t\tisAuthenticated,\n\t\t\t\t);\n\t\t\t\tpullRequestProvider.refresh();\n\t\t\t}\n\t\t}),'

new2 = '\t\tvscode.authentication.onDidChangeSessions(async (e) => {\n\t\t\tif (e.provider.id === "microsoft" && !authProvider.isPatAuth()) {\n\t\t\t\tconst isAuthenticated = await authProvider.isAuthenticated();\n\t\t\t\tawait vscode.commands.executeCommand(\n\t\t\t\t\t"setContext",\n\t\t\t\t\t"azureDevOpsPRs:authenticated",\n\t\t\t\t\tisAuthenticated,\n\t\t\t\t);\n\t\t\t\tpullRequestProvider.refresh();\n\t\t\t}\n\t\t}),'

assert old2 in content, "session listener not found"
content = content.replace(old2, new2)
with open(path, "w") as f:
    f.write(content)
print("  + extension.ts: updated activation and session listener")

path = "package.json"
with open(path) as f:
    content = f.read()

old3 = '        "azureDevOpsPRViewer.comments.autoCollapseResolved": {\n          "type": "boolean",\n          "default": true,\n          "description": "Automatically collapse resolved comment threads"\n        }'

new3 = '        "azureDevOpsPRViewer.patToken": {\n          "type": "string",\n          "default": "",\n          "description": "Personal Access Token (PAT) for Azure DevOps. If set, the extension will use PAT authentication instead of Microsoft account sign-in."\n        },\n        "azureDevOpsPRViewer.comments.autoCollapseResolved": {\n          "type": "boolean",\n          "default": true,\n          "description": "Automatically collapse resolved comment threads"\n        }'

assert old3 in content, "autoCollapseResolved not found"
content = content.replace(old3, new3)

content = content.replace(
    'To get started, sign in to your Azure DevOps account.',
    'To get started, set the **azureDevOpsPRViewer.organization** and **azureDevOpsPRViewer.patToken** settings, or sign in with your Microsoft account.'
)

with open(path, "w") as f:
    f.write(content)
print("  + package.json: added patToken setting and updated welcome message")
ENDOFFILE

echo "==> Compiling and packaging..."
npx tsc --noEmit
npm run compile:extension
npx @vscode/vsce package --no-dependencies

echo ""
echo "=== Done! ==="
echo "VSIX: $(pwd)/$(ls *.vsix)"
