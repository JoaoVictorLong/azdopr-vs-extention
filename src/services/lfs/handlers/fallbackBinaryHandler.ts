import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "../../../utils/logger";
import type { LfsFileHandler, PRContext } from "../fileTypeHandlers";

const logger = Logger.getInstance();

/** Catch-all handler for binary file types without a dedicated handler. */
export class FallbackBinaryHandler implements LfsFileHandler {
	canHandle(_filePath: string, _mimeType?: string): boolean {
		return true;
	}

	async displayFile(fileContent: Buffer, filePath: string, prContext: PRContext): Promise<void> {
		const fileName = path.basename(filePath);
		const fileExt = path.extname(filePath);
		const prId = prContext.pullRequestId;

		logger.debug("[FallbackBinaryHandler] Unsupported file type:", {
			fileName,
			extension: fileExt,
			prId,
			size: fileContent.length,
		});

		const action = await vscode.window.showInformationMessage(
			`Preview not available for ${fileExt} files. File: ${fileName} from PR #${prId}`,
			"Save to Disk",
			"View in Browser",
			"Cancel",
		);

		if (action === "Save to Disk") {
			await this.saveFileToDisk(fileContent, fileName, prContext);
		} else if (action === "View in Browser") {
			await this.openInBrowser(prContext);
		}
	}

	private async saveFileToDisk(
		fileContent: Buffer,
		fileName: string,
		prContext: PRContext,
	): Promise<void> {
		try {
			const defaultUri = vscode.Uri.file(path.join(os.homedir(), "Downloads", fileName));

			const saveUri = await vscode.window.showSaveDialog({
				defaultUri,
				saveLabel: "Save LFS File",
				title: `Save ${fileName} from PR #${prContext.pullRequestId}`,
			});

			if (saveUri) {
				fs.writeFileSync(saveUri.fsPath, fileContent);
				vscode.window.showInformationMessage(`File saved: ${saveUri.fsPath}`);

				const openAction = await vscode.window.showInformationMessage(
					"File saved successfully",
					"Open File",
					"Reveal in Explorer",
				);

				if (openAction === "Open File") {
					await vscode.env.openExternal(saveUri);
				} else if (openAction === "Reveal in Explorer") {
					await vscode.commands.executeCommand("revealFileInOS", saveUri);
				}
			}
		} catch (error) {
			logger.error("[FallbackBinaryHandler] Failed to save file:", error);
			vscode.window.showErrorMessage(
				`Failed to save file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async openInBrowser(prContext: PRContext): Promise<void> {
		try {
			const org = vscode.workspace
				.getConfiguration("azureDevOpsPRViewer")
				.get<string>("organization", "");

			if (!org) {
				vscode.window.showErrorMessage("Organization not configured");
				return;
			}

			const url = `https://dev.azure.com/${org}/${prContext.projectId}/_git/${prContext.repositoryId}/pullrequest/${prContext.pullRequestId}?_a=files&path=${encodeURIComponent(prContext.filePath)}`;

			await vscode.env.openExternal(vscode.Uri.parse(url));
		} catch (error) {
			logger.error("[FallbackBinaryHandler] Failed to open in browser:", error);
			vscode.window.showErrorMessage(
				`Failed to open in browser: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	getMimeType(_filePath: string): string {
		return "application/octet-stream";
	}
}
