import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "../../../utils/logger";
import type { LfsFileHandler, PRContext } from "../fileTypeHandlers";

const logger = Logger.getInstance();

export class ImageFileHandler implements LfsFileHandler {
	private readonly tempDir: string;
	private readonly createdFiles: Set<string> = new Set();

	constructor() {
		this.tempDir = path.join(os.tmpdir(), "azdopr-lfs-images");

		try {
			if (!fs.existsSync(this.tempDir)) {
				fs.mkdirSync(this.tempDir, { recursive: true });
				logger.debug("[ImageFileHandler] Created temp directory:", this.tempDir);
			}
		} catch (error) {
			logger.error("[ImageFileHandler] Failed to create temp directory:", error);
			throw new Error(
				`Failed to create temp directory for images: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	canHandle(filePath: string): boolean {
		const imageExtensions = [
			".png",
			".jpg",
			".jpeg",
			".gif",
			".bmp",
			".tiff",
			".ico",
			".svg",
			".webp",
		];
		return imageExtensions.some((ext) => filePath.toLowerCase().endsWith(ext));
	}

	async displayFile(fileContent: Buffer, filePath: string, prContext: PRContext): Promise<void> {
		const fileName = path.basename(filePath);
		const prId = prContext.pullRequestId;

		logger.debug("[ImageFileHandler] Displaying image:", {
			fileName,
			prId,
			size: fileContent.length,
		});

		if (!fileContent || fileContent.length === 0) {
			throw new Error("Image file content is empty");
		}

		try {
			const timestamp = Date.now();
			const tempFileName = `pr${prId}_${timestamp}_${fileName}`;
			const tempFilePath = path.join(this.tempDir, tempFileName);

			fs.writeFileSync(tempFilePath, fileContent);
			this.createdFiles.add(tempFilePath);

			logger.debug("[ImageFileHandler] Created temp file:", tempFilePath);

			const uri = vscode.Uri.file(tempFilePath);
			await vscode.commands.executeCommand("vscode.open", uri, {
				preview: true,
				viewColumn: vscode.ViewColumn.Beside,
			});

			vscode.window.showInformationMessage(`Opened image: ${fileName} from PR #${prId}`);

			logger.debug("[ImageFileHandler] Successfully opened image:", fileName);
		} catch (error) {
			logger.error("[ImageFileHandler] Failed to display image:", error);
			throw new Error(
				`Failed to display image file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	getMimeType(filePath: string): string {
		const ext = path.extname(filePath).toLowerCase();

		const mimeTypes: Record<string, string> = {
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".bmp": "image/bmp",
			".tiff": "image/tiff",
			".ico": "image/x-icon",
			".svg": "image/svg+xml",
			".webp": "image/webp",
		};

		return mimeTypes[ext] || "image/png";
	}

	dispose(): void {
		logger.debug("[ImageFileHandler] Disposing handler, cleaning up temp files...");

		let deletedCount = 0;
		let errorCount = 0;

		for (const filePath of this.createdFiles) {
			try {
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath);
					deletedCount++;
				}
			} catch (error) {
				logger.warn("[ImageFileHandler] Failed to delete temp file:", filePath, error);
				errorCount++;
			}
		}

		this.createdFiles.clear();

		try {
			if (fs.existsSync(this.tempDir)) {
				const files = fs.readdirSync(this.tempDir);
				if (files.length === 0) {
					fs.rmdirSync(this.tempDir);
					logger.debug("[ImageFileHandler] Removed empty temp directory");
				}
			}
		} catch (error) {
			logger.warn("[ImageFileHandler] Failed to remove temp directory:", error);
		}

		logger.debug("[ImageFileHandler] Cleanup complete:", {
			deleted: deletedCount,
			errors: errorCount,
		});
	}
}
