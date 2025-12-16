/**
 * PDF File Handler for Git LFS Files
 *
 * This handler displays PDF files stored in Git LFS using VS Code's built-in PDF viewer.
 * It creates temporary files on disk since VS Code's PDF viewer requires file:// URIs.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "../../../utils/logger";
import type { LfsFileHandler, PRContext } from "../fileTypeHandlers";

const logger = Logger.getInstance();

/**
 * Handler for PDF files
 *
 * This handler:
 * 1. Creates a temp directory for PDF files
 * 2. Writes the Buffer to a temp file with PR context in filename
 * 3. Opens the file with VS Code's built-in PDF viewer
 * 4. Cleans up temp files on disposal
 *
 * Example usage:
 * ```typescript
 * const handler = new PdfFileHandler();
 * await handler.displayFile(pdfBuffer, '/docs/manual.pdf', prContext);
 * ```
 */
export class PdfFileHandler implements LfsFileHandler {
	private readonly tempDir: string;
	private readonly createdFiles: Set<string> = new Set();

	constructor() {
		// Create temp directory for PDF files
		this.tempDir = path.join(os.tmpdir(), "azdopr-lfs-pdfs");

		try {
			if (!fs.existsSync(this.tempDir)) {
				fs.mkdirSync(this.tempDir, { recursive: true });
				logger.debug("[PdfFileHandler] Created temp directory:", this.tempDir);
			}
		} catch (error) {
			logger.error("[PdfFileHandler] Failed to create temp directory:", error);
			throw new Error(
				`Failed to create temp directory for PDFs: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Check if this handler can handle the given file
	 * @param filePath The file path to check
	 * @returns true if the file has a .pdf extension
	 */
	canHandle(filePath: string): boolean {
		return filePath.toLowerCase().endsWith(".pdf");
	}

	/**
	 * Display a PDF file in VS Code
	 *
	 * This method:
	 * 1. Validates the file content
	 * 2. Creates a unique temp filename with PR context
	 * 3. Writes the Buffer to the temp file
	 * 4. Opens the file with VS Code's PDF viewer
	 * 5. Tracks the file for cleanup
	 *
	 * @param fileContent The PDF file content as a Buffer
	 * @param filePath The original file path (for filename extraction)
	 * @param prContext Context about the PR
	 * @throws Error if display fails
	 */
	async displayFile(fileContent: Buffer, filePath: string, prContext: PRContext): Promise<void> {
		const fileName = path.basename(filePath);
		const prId = prContext.pullRequestId;

		logger.debug("[PdfFileHandler] Displaying PDF:", {
			fileName,
			prId,
			size: fileContent.length,
		});

		// Validate input
		if (!fileContent || fileContent.length === 0) {
			throw new Error("PDF file content is empty");
		}

		try {
			// Create temp file with PR context in filename for uniqueness
			// Format: pr{prId}_{timestamp}_{fileName}
			const timestamp = Date.now();
			const tempFileName = `pr${prId}_${timestamp}_${fileName}`;
			const tempFilePath = path.join(this.tempDir, tempFileName);

			// Write buffer to temp file
			fs.writeFileSync(tempFilePath, fileContent);
			this.createdFiles.add(tempFilePath);

			logger.debug("[PdfFileHandler] Created temp file:", tempFilePath);

			// Open with VS Code's built-in PDF viewer
			const uri = vscode.Uri.file(tempFilePath);

			// Open in a new editor beside the current one
			await vscode.commands.executeCommand("vscode.open", uri, {
				preview: true,
				viewColumn: vscode.ViewColumn.Beside,
			});

			// Show success message with PR context
			vscode.window.showInformationMessage(`Opened PDF: ${fileName} from PR #${prId}`);

			logger.debug("[PdfFileHandler] Successfully opened PDF:", fileName);
		} catch (error) {
			logger.error("[PdfFileHandler] Failed to display PDF:", error);

			// Clean up the temp file if it was created but failed to open
			throw new Error(
				`Failed to display PDF file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Get the MIME type for PDF files
	 * @returns The PDF MIME type
	 */
	getMimeType(): string {
		return "application/pdf";
	}

	/**
	 * Cleanup temp files created by this handler
	 *
	 * This method is called when:
	 * - The extension is deactivated
	 * - The file handler registry is cleared
	 *
	 * It attempts to delete all temp PDF files created during this session.
	 * Errors are logged but not thrown to prevent disrupting extension cleanup.
	 */
	dispose(): void {
		logger.debug("[PdfFileHandler] Disposing handler, cleaning up temp files...");

		let deletedCount = 0;
		let errorCount = 0;

		// Delete all tracked temp files
		for (const filePath of this.createdFiles) {
			try {
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath);
					deletedCount++;
				}
			} catch (error) {
				console.warn("[PdfFileHandler] Failed to delete temp file:", filePath, error);
				errorCount++;
			}
		}

		this.createdFiles.clear();

		// Optionally clean up the temp directory if it's empty
		try {
			if (fs.existsSync(this.tempDir)) {
				const files = fs.readdirSync(this.tempDir);
				if (files.length === 0) {
					fs.rmdirSync(this.tempDir);
					logger.debug("[PdfFileHandler] Removed empty temp directory");
				}
			}
		} catch (error) {
			console.warn("[PdfFileHandler] Failed to remove temp directory:", error);
		}

		logger.debug("[PdfFileHandler] Cleanup complete:", {
			deleted: deletedCount,
			errors: errorCount,
		});
	}

	/**
	 * Get the temp directory path (for testing/debugging)
	 * @returns The temp directory path
	 */
	getTempDirectory(): string {
		return this.tempDir;
	}

	/**
	 * Get count of temp files created (for testing/debugging)
	 * @returns Number of temp files tracked
	 */
	getTempFileCount(): number {
		return this.createdFiles.size;
	}
}
