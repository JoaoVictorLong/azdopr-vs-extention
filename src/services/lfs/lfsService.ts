/**
 * Git LFS Service
 *
 * This service handles detection and downloading of files stored in Git LFS.
 * It uses Azure DevOps' resolveLfs API parameter to automatically resolve
 * LFS pointer files to their actual binary content.
 */

import type * as vscode from "vscode";
import { Logger } from "../../utils/logger";
import type { AzureDevOpsClient } from "../azureDevOpsClient";
import type { FileHandlerRegistry } from "./fileTypeHandlers";
import { LfsCache } from "./lfsCache";

const logger = Logger.getInstance();

/**
 * Parsed information from a Git LFS pointer file
 */
export interface LfsPointerInfo {
	/** The SHA256 hash of the actual file content */
	oid: string;
	/** The size of the actual file in bytes */
	size: number;
}

/**
 * Service for handling Git LFS files
 *
 * ## Architecture: Extensible File Handler Registry Pattern
 *
 * This service uses a registry pattern to handle different file types:
 *
 * ```
 * LfsService (coordinates)
 *    ↓
 * FileHandlerRegistry (dispatches to handlers)
 *    ↓
 * FileTypeHandler implementations:
 *    ├─ PdfHandler (converts PDFs to data URIs for display)
 *    ├─ ImageHandler (converts images to data URIs)
 *    └─ FallbackBinaryHandler (base64 encode other binaries)
 * ```
 *
 * **Adding a new file type:**
 * 1. Create a handler class implementing FileTypeHandler interface
 * 2. Register it in fileTypeHandlers.ts
 * 3. Add the file extension to azureDevOpsPRViewer.lfs.supportedTypes config
 *
 * ## Data Flow
 *
 * 1. **Detection**: Check if file content is an LFS pointer (3-line format)
 * 2. **Parsing**: Extract OID (SHA256 hash) and size from pointer
 * 3. **Cache Check**: Look for already-downloaded file in LfsCache
 * 4. **Download**: If not cached, use Azure DevOps API with `resolveLfs=true`
 * 5. **Handler Dispatch**: FileHandlerRegistry selects handler based on file extension
 * 6. **Processing**: Handler converts binary to displayable format (e.g., data URI)
 * 7. **Caching**: Store processed result in LfsCache (500MB limit by default)
 *
 * ## Features
 *
 * - Detection of LFS pointer files
 * - Parsing of LFS pointer metadata
 * - Downloading actual LFS file content via Azure DevOps API
 * - Caching of downloaded files for performance
 * - Extensible file type handler system
 * - Automatic cache size management
 * - Optional local checkout fallback (future enhancement)
 */
export class LfsService {
	private cache: LfsCache | undefined;

	constructor(
		private readonly azureDevOpsClient: AzureDevOpsClient,
		private readonly fileHandlerRegistry: FileHandlerRegistry,
		readonly extensionContext?: vscode.ExtensionContext,
	) {
		// Initialize cache if extension context is provided
		if (extensionContext) {
			this.cache = new LfsCache(extensionContext);
		}
	}

	/**
	 * Detect if content is a Git LFS pointer file
	 *
	 * LFS pointer files have a specific 3-line format:
	 * ```
	 * version https://git-lfs.github.com/spec/v1
	 * oid sha256:4d7a214614ab2935c943f9e0ff69d22ebbe7a2b7b4e3b0e3e6e5c7d2f1e8c9a0
	 * size 12345678
	 * ```
	 *
	 * @param content The file content to check
	 * @returns true if content is an LFS pointer, false otherwise
	 */
	public isLfsPointer(content: string): boolean {
		const lines = content.trim().split("\n");

		// LFS pointers are exactly 3 lines
		if (lines.length !== 3) {
			return false;
		}

		// Line 1: version specifier
		const versionLine = lines[0].trim();
		if (!versionLine.startsWith("version https://git-lfs.github.com/spec/")) {
			return false;
		}

		// Line 2: OID (SHA256 hash)
		const oidLine = lines[1].trim();
		if (!oidLine.startsWith("oid sha256:")) {
			return false;
		}

		// Line 3: size in bytes
		const sizeLine = lines[2].trim();
		if (!sizeLine.startsWith("size ")) {
			return false;
		}

		// Validate that size is a number
		const sizeStr = sizeLine.substring(5);
		if (!/^\d+$/.test(sizeStr)) {
			return false;
		}

		return true;
	}

	/**
	 * Parse LFS pointer content to extract OID and size
	 *
	 * @param content The LFS pointer file content
	 * @returns Parsed pointer information, or null if not a valid pointer
	 *
	 * Example:
	 * ```typescript
	 * const info = lfsService.parseLfsPointer(pointerContent);
	 * if (info) {
	 *     logger.debug(`File size: ${info.size} bytes`);
	 *     logger.debug(`SHA256: ${info.oid}`);
	 * }
	 * ```
	 */
	public parseLfsPointer(content: string): LfsPointerInfo | null {
		if (!this.isLfsPointer(content)) {
			return null;
		}

		const lines = content.trim().split("\n");

		// Extract OID (remove "oid sha256:" prefix)
		const oidLine = lines[1].trim();
		const oid = oidLine.substring("oid sha256:".length);

		// Extract size (remove "size " prefix and parse as number)
		const sizeLine = lines[2].trim();
		const size = Number.parseInt(sizeLine.substring("size ".length), 10);

		return { oid, size };
	}

	/**
	 * Check if a file path is potentially an LFS file based on extension
	 *
	 * This is a heuristic optimization to avoid checking every file.
	 * Common binary file extensions that are often stored in LFS.
	 *
	 * @param filePath The file path to check
	 * @returns true if the file extension suggests it might be in LFS
	 */
	public isPotentiallyLfsFile(filePath: string): boolean {
		const lfsExtensions = [
			// Documents
			".pdf",
			".doc",
			".docx",
			".ppt",
			".pptx",
			".xls",
			".xlsx",
			// Images
			".png",
			".jpg",
			".jpeg",
			".gif",
			".bmp",
			".tiff",
			".ico",
			".svg",
			// Videos
			".mp4",
			".mov",
			".avi",
			".mkv",
			".webm",
			".flv",
			// Audio
			".mp3",
			".wav",
			".flac",
			".aac",
			".ogg",
			// Archives
			".zip",
			".tar",
			".gz",
			".7z",
			".rar",
			// Executables and libraries
			".exe",
			".dll",
			".so",
			".dylib",
			// Other binary formats
			".bin",
			".dat",
			".db",
			".sqlite",
		];

		const lowerPath = filePath.toLowerCase();
		return lfsExtensions.some((ext) => lowerPath.endsWith(ext));
	}

	/**
	 * Download LFS file content using Azure DevOps API
	 *
	 * This method uses the Azure DevOps Git Items API with the resolveLfs=true
	 * parameter, which automatically resolves LFS pointer files to their actual
	 * binary content. Downloaded files are cached for performance.
	 *
	 * @param projectId The Azure DevOps project ID
	 * @param repositoryId The repository ID
	 * @param path The file path (e.g., "/docs/manual.pdf")
	 * @param version The commit SHA or branch name
	 * @returns Promise resolving to the file content as a Buffer
	 * @throws Error if download fails
	 *
	 * Example:
	 * ```typescript
	 * const buffer = await lfsService.downloadLfsFile(
	 *     projectId,
	 *     repoId,
	 *     '/docs/manual.pdf',
	 *     'abc123...' // commit SHA
	 * );
	 * ```
	 */
	public async downloadLfsFile(
		projectId: string,
		repositoryId: string,
		path: string,
		version: string,
	): Promise<Buffer> {
		// Check cache first if available
		if (this.cache) {
			const cached = this.cache.get(path, version);
			if (cached) {
				logger.debug("[LfsService] Cache hit for LFS file:", path);
				return cached;
			}
		}

		logger.debug("[LfsService] Downloading LFS file (cache miss):", {
			path,
			version: `${version.substring(0, 8)}...`, // Log first 8 chars of version
		});

		try {
			// Use the Azure DevOps Client's LFS-aware method
			// This will call the API with resolveLfs=true to get actual content
			const content = await this.azureDevOpsClient.getFileContentWithLfs(
				projectId,
				repositoryId,
				path,
				version,
				true, // resolveLfs = true
				"binary", // downloadType = binary
			);

			if (!(content instanceof Buffer)) {
				throw new Error("Expected Buffer from getFileContentWithLfs with binary type");
			}

			logger.debug("[LfsService] Successfully downloaded LFS file:", {
				path,
				size: content.length,
			});

			// Cache the content if cache is available
			if (this.cache) {
				this.cache.set(path, version, content);
			}

			return content;
		} catch (error) {
			console.error("[LfsService] Failed to download LFS file:", {
				path,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	/**
	 * Download LFS file using local Git checkout (fallback method)
	 *
	 * **NOTE: This feature is not yet implemented.**
	 *
	 * This would be a fallback when the Azure DevOps API download fails.
	 * It would require Git and Git LFS to be installed on the user's system.
	 *
	 * **Planned implementation:**
	 * 1. Clone repository to temp directory
	 * 2. Checkout specific commit
	 * 3. Run `git lfs pull` for the specific file
	 * 4. Read file content from disk
	 * 5. Clean up temp directory
	 *
	 * **Current behavior:** Throws error indicating feature not available
	 *
	 * @param _projectId The Azure DevOps project ID
	 * @param _repositoryId The repository ID
	 * @param _repositoryName The repository name
	 * @param _path The file path
	 * @param _version The commit SHA or branch name
	 * @returns Promise resolving to the file content as a Buffer
	 * @throws Error indicating feature not implemented
	 */
	public async downloadLfsFileLocal(
		_projectId: string,
		_repositoryId: string,
		_repositoryName: string,
		_path: string,
		_version: string,
	): Promise<Buffer> {
		throw new Error(
			"Local Git LFS checkout not yet implemented. " +
				"Please ensure the file is accessible via Azure DevOps API.",
		);
	}

	/**
	 * Get the file handler registry
	 * @returns The file handler registry instance
	 */
	public getFileHandlerRegistry(): FileHandlerRegistry {
		return this.fileHandlerRegistry;
	}

	/**
	 * Get the LFS cache instance
	 * @returns The cache instance, or undefined if not initialized
	 */
	public getCache(): LfsCache | undefined {
		return this.cache;
	}

	/**
	 * Clear the LFS cache
	 * This is typically called when the user explicitly requests cache clearing
	 */
	public clearCache(): void {
		if (this.cache) {
			this.cache.clear();
		}
	}
}
