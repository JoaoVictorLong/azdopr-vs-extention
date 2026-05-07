import { CACHE_CLEANUP_INTERVAL_MS, PR_CACHE_TTL_MS } from "../constants/cacheConfig";
import type { PRFileChange, PRIteration, PRThread, PullRequest } from "./azureDevOpsClient";

/**
 * Interface for cached PR data
 */
interface CachedPRData {
	fullDetails: PullRequest;
	iterations: PRIteration[];
	fileChanges: PRFileChange[];
	threads: PRThread[];
	timestamp: number;
}

/**
 * Singleton cache for PR details (5 min TTL, 1 min cleanup interval).
 * Caches high-level PR data structures (details, iterations, files, threads)
 * to avoid re-fetching across components. Separate from AzureDevOpsClient's
 * short-term (1 min) HTTP response cache.
 */
export class PRCacheService {
	private static _instance: PRCacheService | undefined;
	private readonly cache: Map<string, CachedPRData> = new Map();
	private readonly defaultTTL: number = PR_CACHE_TTL_MS;

	private constructor() {
		this.startCleanupInterval();
	}

	public static getInstance(): PRCacheService {
		if (!PRCacheService._instance) {
			PRCacheService._instance = new PRCacheService();
		}
		return PRCacheService._instance;
	}

	/** Reset singleton for test isolation */
	public static resetInstance(): void {
		PRCacheService._instance = undefined;
	}

	/**
	 * Generate a unique cache key for a PR
	 */
	private getCacheKey(projectId: string, repositoryId: string, pullRequestId: number): string {
		return `${projectId}:${repositoryId}:${pullRequestId}`;
	}

	/**
	 * Get cached PR data if it exists and is not expired
	 */
	public get(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
	): CachedPRData | undefined {
		const key = this.getCacheKey(projectId, repositoryId, pullRequestId);
		const cached = this.cache.get(key);

		if (!cached) {
			return undefined;
		}

		// Check if cache entry has expired
		const now = Date.now();
		if (now - cached.timestamp > this.defaultTTL) {
			this.cache.delete(key);
			return undefined;
		}

		return cached;
	}

	/**
	 * Store PR data in the cache
	 */
	public set(
		projectId: string,
		repositoryId: string,
		pullRequestId: number,
		fullDetails: PullRequest,
		iterations: PRIteration[],
		fileChanges: PRFileChange[],
		threads: PRThread[],
	): void {
		const key = this.getCacheKey(projectId, repositoryId, pullRequestId);
		this.cache.set(key, {
			fullDetails,
			iterations,
			fileChanges,
			threads,
			timestamp: Date.now(),
		});
	}

	/**
	 * Invalidate (remove) a specific PR from the cache
	 */
	public invalidate(projectId: string, repositoryId: string, pullRequestId: number): void {
		const key = this.getCacheKey(projectId, repositoryId, pullRequestId);
		this.cache.delete(key);
	}

	/**
	 * Remove expired entries from the cache
	 */
	private cleanup(): void {
		const now = Date.now();
		for (const [key, value] of this.cache.entries()) {
			if (now - value.timestamp > this.defaultTTL) {
				this.cache.delete(key);
			}
		}
	}

	/**
	 * Start periodic cleanup of expired cache entries
	 */
	private startCleanupInterval(): void {
		setInterval(() => {
			this.cleanup();
		}, CACHE_CLEANUP_INTERVAL_MS);
	}
}
