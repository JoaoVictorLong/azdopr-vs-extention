/**
 * Fallback Binary File Handler for Git LFS Files
 *
 * This handler serves as a catch-all for binary file types that don't have
 * a dedicated handler. It shows a friendly message to the user and optionally
 * offers to download the file.
 *
 * Examples of files handled here:
 * - Excel files (.xlsx, .xls)
 * - Word documents (.docx, .doc)
 * - PowerPoint presentations (.pptx, .ppt)
 * - Video files (.mp4, .mov, .avi)
 * - Audio files (.mp3, .wav)
 * - Archives (.zip, .tar, .gz)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "../../../utils/logger";
import type { LfsFileHandler, PRContext } from "../fileTypeHandlers";

const logger = Logger.getInstance();

/**
 * Fallback handler for unsupported binary file types
 *
 * This handler:
 * 1. Shows an informational message that the file type is not yet supported
 * 2. Offers to save the file to disk for the user to open with an external app
 * 3. Logs details for potential future handler implementation
 */
export class FallbackBinaryHandler implements LfsFileHandler {
	/**
	 * This handler can handle ANY file type (it's a catch-all)
	 * It should be registered LAST in the handler registry
	 * @returns Always returns true (catch-all handler)
	 */
	canHandle(_filePath: string, _mimeType?: string): boolean {
		// This is a catch-all handler, so it can handle anything
		return true;
	}

	/**
	 * Display a message about the unsupported file type
	 *
	 * @param fileContent The file content (not displayed directly)
	 * @param filePath The file path (for extension and filename)
	 * @param prContext Context about the PR
	 */
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

		// Show info message with options
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

	/**
	 * Save the file to a user-selected location
	 */
	private async saveFileToDisk(
		fileContent: Buffer,
		fileName: string,
		prContext: PRContext,
	): Promise<void> {
		try {
			// Suggest a default location in the user's Downloads folder
			const defaultUri = vscode.Uri.file(path.join(os.homedir(), "Downloads", fileName));

			const saveUri = await vscode.window.showSaveDialog({
				defaultUri,
				saveLabel: "Save LFS File",
				title: `Save ${fileName} from PR #${prContext.pullRequestId}`,
			});

			if (saveUri) {
				fs.writeFileSync(saveUri.fsPath, fileContent);
				vscode.window.showInformationMessage(`File saved: ${saveUri.fsPath}`);

				// Optionally open the file location
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

	/**
	 * Open the file in Azure DevOps web browser
	 */
	private async openInBrowser(prContext: PRContext): Promise<void> {
		try {
			// Get organization from config
			const org = vscode.workspace
				.getConfiguration("azureDevOpsPRViewer")
				.get<string>("organization", "");

			if (!org) {
				vscode.window.showErrorMessage("Organization not configured");
				return;
			}

			// Build Azure DevOps URL
			// Note: This is a simplified URL. The actual PR file URL structure may vary
			const url = `https://dev.azure.com/${org}/${prContext.projectId}/_git/${prContext.repositoryId}/pullrequest/${prContext.pullRequestId}?_a=files&path=${encodeURIComponent(prContext.filePath)}`;

			await vscode.env.openExternal(vscode.Uri.parse(url));
		} catch (error) {
			logger.error("[FallbackBinaryHandler] Failed to open in browser:", error);
			vscode.window.showErrorMessage(
				`Failed to open in browser: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Get generic MIME type
	 * @returns application/octet-stream (generic binary type)
	 */
	getMimeType(_filePath: string): string {
		return "application/octet-stream";
	}

	/**
	 * No cleanup needed for this handler
	 */
	dispose(): void {
		// No resources to clean up
		logger.debug("[FallbackBinaryHandler] Handler disposed");
	}
}
