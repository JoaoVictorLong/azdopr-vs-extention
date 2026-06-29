#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Instalando dependencias..."
npm install

echo "==> Aplicando modificacoes de autenticacao PAT..."

# 1. authProvider.ts — substituir apenas se for a versao original (sem PAT)
python3 << 'ENDOFFILE'
path = "src/auth/authProvider.ts"
with open(path) as f:
    c = f.read()

if 'getPatToken' in c:
    print("  + authProvider.ts: ja modificado, pulando")
else:
    new = r'''import * as vscode from "vscode";

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
}'''
    with open(path, "w") as f:
        f.write(new)
    print("  + authProvider.ts: modificado")
ENDOFFILE

# 2. azureDevOpsClient.ts — getAuthHeaders com Basic auth (se ainda nao tiver)
python3 << 'ENDOFFILE'
path = "src/services/azureDevOpsClient.ts"
with open(path) as f:
    c = f.read()

if 'getAuthScheme' in c:
    print("  + azureDevOpsClient.ts: ja modificado, pulando")
else:
    old = '\tprivate async getAuthHeaders(): Promise<Record<string, string>> {\n\t\tconst token = await this.authProvider.getAccessToken();\n\t\tif (!token) {\n\t\t\tthrow new Error("Not authenticated");\n\t\t}\n\t\treturn {\n\t\t\tAuthorization: `Bearer ${token}`,\n\t\t};\n\t}'
    new = '\tprivate async getAuthHeaders(): Promise<Record<string, string>> {\n\t\tconst token = await this.authProvider.getAccessToken();\n\t\tif (!token) {\n\t\t\tthrow new Error("Not authenticated");\n\t\t}\n\t\tconst scheme = this.authProvider.getAuthScheme();\n\t\tif (scheme === "Basic") {\n\t\t\tconst encoded = Buffer.from(`:${token}`).toString("base64");\n\t\t\treturn { Authorization: `Basic ${encoded}` };\n\t\t}\n\t\treturn {\n\t\t\tAuthorization: `Bearer ${token}`,\n\t\t};\n\t}'
    if old in c:
        c = c.replace(old, new)
        with open(path, "w") as f:
            f.write(c)
        print("  + azureDevOpsClient.ts: modificado")
    else:
        print("  + azureDevOpsClient.ts: padrao nao encontrado, pulando")
ENDOFFILE

# 3. extension.ts — log PAT + session listener
python3 << 'ENDOFFILE'
path = "src/extension.ts"
with open(path) as f:
    c = f.read()

if 'authProvider.isPatAuth' in c:
    print("  + extension.ts: ja modificado, pulando")
else:
    old1 = '\tauthProvider = new AzureDevOpsAuthProvider();\n\n\tconst isAuthenticated = await authProvider.isAuthenticated();\n\tawait vscode.commands.executeCommand(\n\t\t"setContext",\n\t\t"azureDevOpsPRs:authenticated",\n\t\tisAuthenticated,\n\t);\n\n\tazureDevOpsClient = new AzureDevOpsClient(authProvider);'
    new1 = '\tauthProvider = new AzureDevOpsAuthProvider();\n\n\tconst isAuthenticated = await authProvider.isAuthenticated();\n\tawait vscode.commands.executeCommand(\n\t\t"setContext",\n\t\t"azureDevOpsPRs:authenticated",\n\t\tisAuthenticated,\n\t);\n\n\tif (authProvider.isPatAuth()) {\n\t\tlogger.info("PAT authentication configured");\n\t}\n\n\tazureDevOpsClient = new AzureDevOpsClient(authProvider);'

    if old1 in c:
        c = c.replace(old1, new1)
        old2 = '\t\tvscode.authentication.onDidChangeSessions(async (e) => {\n\t\t\tif (e.provider.id === "microsoft") {\n\t\t\t\tconst isAuthenticated = await authProvider.isAuthenticated();\n\t\t\t\tawait vscode.commands.executeCommand(\n\t\t\t\t\t"setContext",\n\t\t\t\t\t"azureDevOpsPRs:authenticated",\n\t\t\t\t\tisAuthenticated,\n\t\t\t\t);\n\t\t\t\tpullRequestProvider.refresh();\n\t\t\t}\n\t\t}),'
        new2 = '\t\tvscode.authentication.onDidChangeSessions(async (e) => {\n\t\t\tif (e.provider.id === "microsoft" && !authProvider.isPatAuth()) {\n\t\t\t\tconst isAuthenticated = await authProvider.isAuthenticated();\n\t\t\t\tawait vscode.commands.executeCommand(\n\t\t\t\t\t"setContext",\n\t\t\t\t\t"azureDevOpsPRs:authenticated",\n\t\t\t\t\tisAuthenticated,\n\t\t\t\t);\n\t\t\t\tpullRequestProvider.refresh();\n\t\t\t}\n\t\t}),'
        if old2 in c:
            c = c.replace(old2, new2)

        with open(path, "w") as f:
            f.write(c)
        print("  + extension.ts: modificado")
    else:
        print("  + extension.ts: padrao nao encontrado, pulando")
ENDOFFILE

# 4. package.json — patToken + activationEvents + welcome
python3 << 'ENDOFFILE'
import json, re

path = "package.json"
with open(path) as f:
    pkg = json.load(f)

changed = False

if 'activationEvents' not in pkg:
    pkg['activationEvents'] = ['onView:azureDevOpsPRs']
    changed = True

props = pkg['contributes']['configuration']['properties']
if 'azureDevOpsPRViewer.patToken' not in props:
    props['azureDevOpsPRViewer.patToken'] = {
        "type": "string",
        "default": "",
        "description": "Personal Access Token (PAT) for Azure DevOps. If set, the extension will use PAT authentication instead of Microsoft account sign-in."
    }
    changed = True

if changed:
    with open(path, 'w') as f:
        json.dump(pkg, f, indent=2)
        f.write('\n')

with open(path) as f:
    raw = f.read()

old_welcome = 'To get started, sign in to your Azure DevOps account.'
if old_welcome in raw:
    raw = raw.replace(old_welcome, 'To get started, set the **azureDevOpsPRViewer.organization** and **azureDevOpsPRViewer.patToken** settings, or sign in with your Microsoft account.')
    with open(path, 'w') as f:
        f.write(raw)
    print("  + package.json: patToken + activationEvents + welcome adicionados")
else:
    print("  + package.json: ja modificado, pulando")
ENDOFFILE

echo "==> Compilando..."
npm run compile:extension

echo "==> Limpando VSIXs antigos..."
rm -f *.vsix

echo "==> Gerando VSIX (incluindo dependencias)..."
npx @vscode/vsce package

echo "==> Removendo extensao original (johncwaters.azdopr)..."
code --uninstall-extension johncwaters.azdopr 2>/dev/null || true

echo "==> Instalando no VS Code..."
VSIX=$(ls *.vsix 2>/dev/null | head -1)
if [ -n "$VSIX" ]; then
  code --install-extension "$VSIX" --force
  echo ""
  echo "=== Pronto! ==="
  echo "Extensao '$VSIX' (joaovictorlong.azdopr-fork) instalada."
  echo "Recarregue o VS Code (Ctrl+Shift+P -> Developer: Reload Window)"
else
  echo ""
  echo "=== ERRO: VSIX nao foi gerado ==="
  exit 1
fi
