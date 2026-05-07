import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "../../../utils/logger";
import type { LfsFileHandler, PRContext } from "../fileTypeHandlers";

const logger = Logger.getInstance();

export class PdfFileHandler implements LfsFileHandler {
	private readonly tempDir: string;
	private readonly createdFiles: Set<string> = new Set();

	constructor() {
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

	canHandle(filePath: string): boolean {
		return filePath.toLowerCase().endsWith(".pdf");
	}

	async displayFile(fileContent: Buffer, filePath: string, prContext: PRContext): Promise<void> {
		const fileName = path.basename(filePath);
		const prId = prContext.pullRequestId;

		logger.debug("[PdfFileHandler] Displaying PDF:", {
			fileName,
			prId,
			size: fileContent.length,
		});

		if (!fileContent || fileContent.length === 0) {
			throw new Error("PDF file content is empty");
		}

		try {
			const timestamp = Date.now();
			const tempFileName = `pr${prId}_${timestamp}_${fileName}`;
			const tempFilePath = path.join(this.tempDir, tempFileName);

			fs.writeFileSync(tempFilePath, fileContent);
			this.createdFiles.add(tempFilePath);

			logger.debug("[PdfFileHandler] Created temp file:", tempFilePath);

			const uri = vscode.Uri.file(tempFilePath);
			await vscode.commands.executeCommand("vscode.open", uri, {
				preview: true,
				viewColumn: vscode.ViewColumn.Beside,
			});

			vscode.window.showInformationMessage(`Opened PDF: ${fileName} from PR #${prId}`);

			logger.debug("[PdfFileHandler] Successfully opened PDF:", fileName);
		} catch (error) {
			logger.error("[PdfFileHandler] Failed to display PDF:", error);

			throw new Error(
				`Failed to display PDF file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	getMimeType(): string {
		return "application/pdf";
	}

	dispose(): void {
		logger.debug("[PdfFileHandler] Disposing handler, cleaning up temp files...");

		let deletedCount = 0;
		let errorCount = 0;

		for (const filePath of this.createdFiles) {
			try {
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath);
					deletedCount++;
				}
			} catch (error) {
				logger.warn("[PdfFileHandler] Failed to delete temp file:", filePath, error);
				errorCount++;
			}
		}

		this.createdFiles.clear();

		try {
			if (fs.existsSync(this.tempDir)) {
				const files = fs.readdirSync(this.tempDir);
				if (files.length === 0) {
					fs.rmdirSync(this.tempDir);
					logger.debug("[PdfFileHandler] Removed empty temp directory");
				}
			}
		} catch (error) {
			logger.warn("[PdfFileHandler] Failed to remove temp directory:", error);
		}

		logger.debug("[PdfFileHandler] Cleanup complete:", {
			deleted: deletedCount,
			errors: errorCount,
		});
	}
}
