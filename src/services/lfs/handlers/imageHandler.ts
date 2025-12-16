/**
 * Image File Handler for Git LFS Files (SCAFFOLD)
 *
 * This handler displays image files stored in Git LFS using VS Code's built-in image viewer.
 * Similar to PDF handler, it creates temporary files on disk.
 *
 * NOTE: This is a scaffold implementation. Future enhancements could include:
 * - Side-by-side image diff comparison
 * - Image overlay/difference visualization
 * - Metadata display (dimensions, file size, format)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "../../../utils/logger";
import type { LfsFileHandler, PRContext } from "../fileTypeHandlers";

const logger = Logger.getInstance();

/**
 * Handler for image files (PNG, JPG, JPEG, GIF, BMP, etc.)
 *
 * This scaffold handler provides basic image viewing functionality.
 * Images are written to temp files and opened with VS Code's built-in image viewer.
 *
 * Future enhancements:
 * - Compare mode: Show before/after images side-by-side
 * - Diff visualization: Highlight changed pixels
 * - Zoom controls and pan
 */
export class ImageFileHandler implements LfsFileHandler {
	private readonly tempDir: string;
	private readonly createdFiles: Set<string> = new Set();

	constructor() {
		// Create temp directory for image files
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

	/**
	 * Check if this handler can handle the given file
	 * @param filePath The file path to check
	 * @returns true if the file has an image extension
	 */
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

	/**
	 * Display an image file in VS Code
	 *
	 * @param fileContent The image file content as a Buffer
	 * @param filePath The original file path (for filename and extension)
	 * @param prContext Context about the PR
	 * @throws Error if display fails
	 */
	async displayFile(fileContent: Buffer, filePath: string, prContext: PRContext): Promise<void> {
		const fileName = path.basename(filePath);
		const prId = prContext.pullRequestId;

		logger.debug("[ImageFileHandler] Displaying image:", {
			fileName,
			prId,
			size: fileContent.length,
		});

		// Validate input
		if (!fileContent || fileContent.length === 0) {
			throw new Error("Image file content is empty");
		}

		try {
			// Create temp file with PR context in filename
			const timestamp = Date.now();
			const tempFileName = `pr${prId}_${timestamp}_${fileName}`;
			const tempFilePath = path.join(this.tempDir, tempFileName);

			// Write buffer to temp file
			fs.writeFileSync(tempFilePath, fileContent);
			this.createdFiles.add(tempFilePath);

			logger.debug("[ImageFileHandler] Created temp file:", tempFilePath);

			// Open with VS Code's built-in image viewer
			const uri = vscode.Uri.file(tempFilePath);

			// Open in a new editor beside the current one
			await vscode.commands.executeCommand("vscode.open", uri, {
				preview: true,
				viewColumn: vscode.ViewColumn.Beside,
			});

			// Show success message
			vscode.window.showInformationMessage(`Opened image: ${fileName} from PR #${prId}`);

			logger.debug("[ImageFileHandler] Successfully opened image:", fileName);
		} catch (error) {
			logger.error("[ImageFileHandler] Failed to display image:", error);
			throw new Error(
				`Failed to display image file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Get the MIME type for an image file
	 * @param filePath The file path (used for extension detection)
	 * @returns The appropriate MIME type
	 */
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

		return mimeTypes[ext] || "image/png"; // Default to PNG
	}

	/**
	 * Cleanup temp files created by this handler
	 */
	dispose(): void {
		logger.debug("[ImageFileHandler] Disposing handler, cleaning up temp files...");

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
				console.warn("[ImageFileHandler] Failed to delete temp file:", filePath, error);
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
					logger.debug("[ImageFileHandler] Removed empty temp directory");
				}
			}
		} catch (error) {
			console.warn("[ImageFileHandler] Failed to remove temp directory:", error);
		}

		logger.debug("[ImageFileHandler] Cleanup complete:", {
			deleted: deletedCount,
			errors: errorCount,
		});
	}
}
