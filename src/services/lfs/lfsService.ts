import type * as vscode from "vscode";
import { Logger } from "../../utils/logger";
import type { AzureDevOpsClient } from "../azureDevOpsClient";
import type { FileHandlerRegistry } from "./fileTypeHandlers";
import { LfsCache } from "./lfsCache";

const logger = Logger.getInstance();

export interface LfsPointerInfo {
	oid: string;
	size: number;
}

export class LfsService {
	private cache: LfsCache | undefined;

	constructor(
		private readonly azureDevOpsClient: AzureDevOpsClient,
		readonly _fileHandlerRegistry: FileHandlerRegistry,
		readonly extensionContext?: vscode.ExtensionContext,
	) {
		if (extensionContext) {
			this.cache = new LfsCache(extensionContext);
		}
	}

	/** Check if content matches the 3-line LFS pointer format. */
	public isLfsPointer(content: string): boolean {
		const lines = content.trim().split("\n");

		if (lines.length !== 3) {
			return false;
		}

		const versionLine = lines[0].trim();
		if (!versionLine.startsWith("version https://git-lfs.github.com/spec/")) {
			return false;
		}

		const oidLine = lines[1].trim();
		if (!oidLine.startsWith("oid sha256:")) {
			return false;
		}

		const sizeLine = lines[2].trim();
		if (!sizeLine.startsWith("size ")) {
			return false;
		}

		const sizeStr = sizeLine.substring(5);
		if (!/^\d+$/.test(sizeStr)) {
			return false;
		}

		return true;
	}

	public parseLfsPointer(content: string): LfsPointerInfo | null {
		if (!this.isLfsPointer(content)) {
			return null;
		}

		const lines = content.trim().split("\n");

		const oidLine = lines[1].trim();
		const oid = oidLine.substring("oid sha256:".length);

		const sizeLine = lines[2].trim();
		const size = Number.parseInt(sizeLine.substring("size ".length), 10);

		return { oid, size };
	}

	/** Heuristic check based on common binary file extensions. */
	public isPotentiallyLfsFile(filePath: string): boolean {
		const lfsExtensions = [
			".pdf",
			".doc",
			".docx",
			".ppt",
			".pptx",
			".xls",
			".xlsx",
			".png",
			".jpg",
			".jpeg",
			".gif",
			".bmp",
			".tiff",
			".ico",
			".svg",
			".mp4",
			".mov",
			".avi",
			".mkv",
			".webm",
			".flv",
			".mp3",
			".wav",
			".flac",
			".aac",
			".ogg",
			".zip",
			".tar",
			".gz",
			".7z",
			".rar",
			".exe",
			".dll",
			".so",
			".dylib",
			".bin",
			".dat",
			".db",
			".sqlite",
		];

		const lowerPath = filePath.toLowerCase();
		return lfsExtensions.some((ext) => lowerPath.endsWith(ext));
	}

	/** Download LFS file content using Azure DevOps API with resolveLfs=true. */
	public async downloadLfsFile(
		projectId: string,
		repositoryId: string,
		path: string,
		version: string,
	): Promise<Buffer> {
		if (this.cache) {
			const cached = this.cache.get(path, version);
			if (cached) {
				logger.debug("[LfsService] Cache hit for LFS file:", path);
				return cached;
			}
		}

		logger.debug("[LfsService] Downloading LFS file (cache miss):", {
			path,
			version: `${version.substring(0, 8)}...`,
		});

		try {
			const content = await this.azureDevOpsClient.getFileContentWithLfs(
				projectId,
				repositoryId,
				path,
				version,
				true,
				"binary",
			);

			if (!(content instanceof Buffer)) {
				throw new Error("Expected Buffer from getFileContentWithLfs with binary type");
			}

			logger.debug("[LfsService] Successfully downloaded LFS file:", {
				path,
				size: content.length,
			});

			if (this.cache) {
				this.cache.set(path, version, content);
			}

			return content;
		} catch (error) {
			logger.error("[LfsService] Failed to download LFS file:", {
				path,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	public clearCache(): void {
		if (this.cache) {
			this.cache.clear();
		}
	}
}
