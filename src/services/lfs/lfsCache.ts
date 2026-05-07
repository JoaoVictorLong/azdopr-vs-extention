import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type * as vscode from "vscode";
import { Logger } from "../../utils/logger";

const logger = Logger.getInstance();

interface LfsCacheEntry {
	content: Buffer;
	timestamp: number;
	size: number;
}

interface DiskCacheFileInfo {
	path: string;
	size: number;
	mtime: number;
}

export class LfsCache {
	private readonly cacheDir: string;
	private readonly memoryCache: Map<string, LfsCacheEntry> = new Map();
	private readonly maxCacheSize: number;
	private readonly maxAge: number;

	constructor(
		context: vscode.ExtensionContext,
		maxCacheSizeMB: number = 500,
		maxAgeDays: number = 7,
	) {
		this.cacheDir = path.join(context.globalStorageUri.fsPath, "lfs-cache");
		this.maxCacheSize = maxCacheSizeMB * 1024 * 1024;
		this.maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
		try {
			if (!fs.existsSync(this.cacheDir)) {
				fs.mkdirSync(this.cacheDir, { recursive: true });
				logger.debug("LfsCache: Created cache directory:", this.cacheDir);
			}
		} catch (error) {
			logger.error("LfsCache: Failed to create cache directory:", error);
		}
	}

	private getCacheKey(filePath: string, version: string): string {
		const key = `${filePath}:${version}`;
		return crypto.createHash("md5").update(key).digest("hex");
	}

	public get(filePath: string, version: string): Buffer | undefined {
		const key = this.getCacheKey(filePath, version);

		const memEntry = this.memoryCache.get(key);
		if (memEntry && Date.now() - memEntry.timestamp < this.maxAge) {
			logger.debug("LfsCache: Memory cache hit:", filePath);
			return memEntry.content;
		}

		const diskPath = path.join(this.cacheDir, key);
		if (fs.existsSync(diskPath)) {
			const stats = fs.statSync(diskPath);
			const age = Date.now() - stats.mtimeMs;

			if (age < this.maxAge) {
				logger.debug("LfsCache: Disk cache hit:", filePath);

				try {
					const content = fs.readFileSync(diskPath);

					this.memoryCache.set(key, {
						content,
						timestamp: Date.now(),
						size: content.length,
					});

					return content;
				} catch (error) {
					logger.error("LfsCache: Failed to read cache file:", error);
					try {
						fs.unlinkSync(diskPath);
					} catch (deleteError) {
						logger.error("LfsCache: Failed to delete corrupted cache file:", deleteError);
					}
				}
			} else {
				logger.debug("LfsCache: Cache entry expired, deleting:", filePath);
				try {
					fs.unlinkSync(diskPath);
				} catch (error) {
					logger.error("LfsCache: Failed to delete expired cache file:", error);
				}
			}
		}

		return undefined;
	}

	public set(filePath: string, version: string, content: Buffer): void {
		const key = this.getCacheKey(filePath, version);

		logger.debug("LfsCache: Caching file:", {
			filePath,
			version: `${version.substring(0, 8)}...`,
			size: content.length,
		});

		this.memoryCache.set(key, {
			content,
			timestamp: Date.now(),
			size: content.length,
		});
		const diskPath = path.join(this.cacheDir, key);
		try {
			fs.writeFileSync(diskPath, content);
		} catch (error) {
			logger.error("LfsCache: Failed to write cache file:", error);
			return;
		}

		this.cleanup();
	}

	private cleanup(): void {
		try {
			const files = fs.readdirSync(this.cacheDir);
			let totalSize = 0;

			const fileStats: DiskCacheFileInfo[] = [];
			for (const file of files) {
				const filePath = path.join(this.cacheDir, file);
				try {
					const stats = fs.statSync(filePath);
					totalSize += stats.size;
					fileStats.push({
						path: filePath,
						size: stats.size,
						mtime: stats.mtimeMs,
					});
				} catch (error) {
					logger.warn("[LfsCache] Failed to stat cache file:", filePath, error);
				}
			}

			logger.debug("LfsCache: Cache size:", {
				totalMB: (totalSize / (1024 * 1024)).toFixed(2),
				maxMB: (this.maxCacheSize / (1024 * 1024)).toFixed(2),
				fileCount: files.length,
			});

			if (totalSize > this.maxCacheSize) {
				logger.debug("LfsCache: Cache size exceeded, performing cleanup...");

				fileStats.sort((a, b) => a.mtime - b.mtime);

				let deletedCount = 0;
				let deletedSize = 0;

				for (const fileInfo of fileStats) {
					if (totalSize <= this.maxCacheSize) {
						break;
					}

					try {
						fs.unlinkSync(fileInfo.path);
						totalSize -= fileInfo.size;
						deletedSize += fileInfo.size;
						deletedCount++;
					} catch (error) {
						logger.error(`LfsCache: Failed to delete cache file: ${fileInfo.path}`, error);
					}
				}

				logger.debug("LfsCache: Cleanup complete:", {
					deletedFiles: deletedCount,
					deletedMB: (deletedSize / (1024 * 1024)).toFixed(2),
					remainingMB: (totalSize / (1024 * 1024)).toFixed(2),
				});
			}
		} catch (error) {
			logger.error("LfsCache: Cleanup failed:", error);
		}
	}

	public clear(): void {
		logger.debug("LfsCache: Clearing all cache...");
		this.memoryCache.clear();
		try {
			const files = fs.readdirSync(this.cacheDir);
			let deletedCount = 0;

			for (const file of files) {
				try {
					fs.unlinkSync(path.join(this.cacheDir, file));
					deletedCount++;
				} catch (error) {
					logger.error(`LfsCache: Failed to delete cache file: ${file}`, error);
				}
			}

			logger.debug("LfsCache: Cache cleared:", {
				deletedFiles: deletedCount,
			});
		} catch (error) {
			logger.error("LfsCache: Failed to clear cache:", error);
		}
	}

	public getStats(): { totalSizeMB: number; fileCount: number; maxSizeMB: number } {
		try {
			const files = fs.readdirSync(this.cacheDir);
			let totalSize = 0;

			for (const file of files) {
				try {
					const stats = fs.statSync(path.join(this.cacheDir, file));
					totalSize += stats.size;
				} catch (_error) {
					// Ignore errors for individual files
				}
			}

			return {
				totalSizeMB: totalSize / (1024 * 1024),
				fileCount: files.length,
				maxSizeMB: this.maxCacheSize / (1024 * 1024),
			};
		} catch (error) {
			logger.error("LfsCache: Failed to get stats:", error);
			return {
				totalSizeMB: 0,
				fileCount: 0,
				maxSizeMB: this.maxCacheSize / (1024 * 1024),
			};
		}
	}
}
