/**
 * LFS Cache System
 *
 * This module provides a two-tier caching system for Git LFS files:
 * - Memory cache: Fast access for recently used files
 * - Disk cache: Persistent storage for files across sessions
 *
 * The cache has configurable size limits and TTL (time-to-live) to prevent
 * unbounded growth. Least Recently Used (LRU) eviction is used when limits are exceeded.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type * as vscode from "vscode";
import { Logger } from "../../utils/logger";

const logger = Logger.getInstance();

/**
 * Cache entry metadata
 */
interface LfsCacheEntry {
	/** The cached file content */
	content: Buffer;
	/** Timestamp when the entry was cached */
	timestamp: number;
	/** Size of the content in bytes */
	size: number;
	/** Git LFS OID (SHA256 hash) if available */
	oid: string;
}

/**
 * Disk cache file metadata
 */
interface DiskCacheFileInfo {
	/** Full path to the cache file */
	path: string;
	/** File size in bytes */
	size: number;
	/** Last modification time (milliseconds since epoch) */
	mtime: number;
}

/**
 * LFS file cache with memory and disk storage
 *
 * This cache provides:
 * - Fast in-memory access for recently accessed files
 * - Persistent disk storage for files across VS Code sessions
 * - Automatic cleanup based on size limits and age
 * - LRU (Least Recently Used) eviction strategy
 *
 * Example usage:
 * ```typescript
 * const cache = new LfsCache(context);
 *
 * // Check cache
 * const cached = cache.get('/docs/manual.pdf', 'abc123...');
 * if (cached) {
 *     return cached; // Cache hit
 * }
 *
 * // Download and cache
 * const content = await downloadFile(...);
 * cache.set('/docs/manual.pdf', 'abc123...', content);
 * ```
 */
export class LfsCache {
	private readonly cacheDir: string;
	private readonly memoryCache: Map<string, LfsCacheEntry> = new Map();
	private readonly maxCacheSize: number; // in bytes
	private readonly maxAge: number; // in milliseconds

	/**
	 * Create a new LFS cache
	 * @param context VS Code extension context (for storage path)
	 * @param maxCacheSizeMB Maximum cache size in MB (default: 500MB)
	 * @param maxAgeDays Maximum age for cache entries in days (default: 7 days)
	 */
	constructor(
		context: vscode.ExtensionContext,
		maxCacheSizeMB: number = 500,
		maxAgeDays: number = 7,
	) {
		// Use extension's global storage for cache directory
		this.cacheDir = path.join(context.globalStorageUri.fsPath, "lfs-cache");
		this.maxCacheSize = maxCacheSizeMB * 1024 * 1024; // Convert MB to bytes
		this.maxAge = maxAgeDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds

		// Ensure cache directory exists
		try {
			if (!fs.existsSync(this.cacheDir)) {
				fs.mkdirSync(this.cacheDir, { recursive: true });
				logger.debug("LfsCache: Created cache directory:", this.cacheDir);
			}
		} catch (error) {
			logger.error("LfsCache: Failed to create cache directory:", error);
		}
	}

	/**
	 * Generate cache key from file path and version
	 * @param filePath The file path
	 * @param version The commit SHA or branch name
	 * @returns MD5 hash to use as cache key
	 */
	private getCacheKey(filePath: string, version: string): string {
		const key = `${filePath}:${version}`;
		return crypto.createHash("md5").update(key).digest("hex");
	}

	/**
	 * Get cached content for a file
	 * @param filePath The file path
	 * @param version The commit SHA or branch name
	 * @returns Cached Buffer if found and not expired, undefined otherwise
	 */
	public get(filePath: string, version: string): Buffer | undefined {
		const key = this.getCacheKey(filePath, version);

		// Check memory cache first (fastest)
		const memEntry = this.memoryCache.get(key);
		if (memEntry && Date.now() - memEntry.timestamp < this.maxAge) {
			logger.debug("LfsCache: Memory cache hit:", filePath);
			return memEntry.content;
		}

		// Check disk cache
		const diskPath = path.join(this.cacheDir, key);
		if (fs.existsSync(diskPath)) {
			const stats = fs.statSync(diskPath);
			const age = Date.now() - stats.mtimeMs;

			if (age < this.maxAge) {
				logger.debug("LfsCache: Disk cache hit:", filePath);

				try {
					const content = fs.readFileSync(diskPath);

					// Populate memory cache for faster subsequent access
					this.memoryCache.set(key, {
						content,
						timestamp: Date.now(),
						size: content.length,
						oid: "", // Could extract from metadata if needed
					});

					return content;
				} catch (error) {
					logger.error("LfsCache: Failed to read cache file:", error);
					// Delete corrupted cache file
					try {
						fs.unlinkSync(diskPath);
					} catch (deleteError) {
						logger.error("LfsCache: Failed to delete corrupted cache file:", deleteError);
					}
				}
			} else {
				// Expired, delete it
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

	/**
	 * Store content in cache
	 * @param filePath The file path
	 * @param version The commit SHA or branch name
	 * @param content The file content to cache
	 */
	public set(filePath: string, version: string, content: Buffer): void {
		const key = this.getCacheKey(filePath, version);

		logger.debug("LfsCache: Caching file:", {
			filePath,
			version: `${version.substring(0, 8)}...`,
			size: content.length,
		});

		// Store in memory cache
		this.memoryCache.set(key, {
			content,
			timestamp: Date.now(),
			size: content.length,
			oid: "",
		});

		// Store on disk
		const diskPath = path.join(this.cacheDir, key);
		try {
			fs.writeFileSync(diskPath, content);
		} catch (error) {
			logger.error("LfsCache: Failed to write cache file:", error);
			return; // Don't cleanup if we couldn't write
		}

		// Cleanup if cache too large
		this.cleanup();
	}

	/**
	 * Cleanup old and oversized cache entries
	 *
	 * This method:
	 * 1. Scans all cache files
	 * 2. Calculates total cache size
	 * 3. If over limit, deletes oldest files first (LRU eviction)
	 */
	private cleanup(): void {
		try {
			const files = fs.readdirSync(this.cacheDir);
			let totalSize = 0;

			// Gather file stats
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
					console.warn("[LfsCache] Failed to stat cache file:", filePath, error);
				}
			}

			logger.debug("LfsCache: Cache size:", {
				totalMB: (totalSize / (1024 * 1024)).toFixed(2),
				maxMB: (this.maxCacheSize / (1024 * 1024)).toFixed(2),
				fileCount: files.length,
			});

			// If over limit, delete oldest files first
			if (totalSize > this.maxCacheSize) {
				logger.debug("LfsCache: Cache size exceeded, performing cleanup...");

				// Sort by modification time (oldest first)
				fileStats.sort((a, b) => a.mtime - b.mtime);

				let deletedCount = 0;
				let deletedSize = 0;

				for (const fileInfo of fileStats) {
					if (totalSize <= this.maxCacheSize) {
						break; // Reached target size
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

	/**
	 * Clear all cached content
	 *
	 * This removes all files from both memory and disk cache.
	 * Useful for troubleshooting or when the user explicitly requests cache clearing.
	 */
	public clear(): void {
		logger.debug("LfsCache: Clearing all cache...");

		// Clear memory cache
		this.memoryCache.clear();

		// Clear disk cache
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

	/**
	 * Get cache statistics
	 * @returns Cache statistics including size and file count
	 */
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

	/**
	 * Get the cache directory path
	 * @returns The cache directory path
	 */
	public getCacheDirectory(): string {
		return this.cacheDir;
	}
}
