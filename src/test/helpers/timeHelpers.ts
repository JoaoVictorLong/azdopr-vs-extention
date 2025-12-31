import * as sinon from "sinon";

/**
 * Test clock wrapper for easier time manipulation in tests
 */
export class TestClock {
	private clock: sinon.SinonFakeTimers;

	constructor(now: number | Date = Date.now()) {
		this.clock = sinon.useFakeTimers({
			now,
			shouldAdvanceTime: false,
			shouldClearNativeTimers: true,
		});
	}

	/**
	 * Advance time by the specified number of milliseconds
	 */
	tick(ms: number): void {
		this.clock.tick(ms);
	}

	/**
	 * Advance time asynchronously (for async timers)
	 */
	async tickAsync(ms: number): Promise<void> {
		await this.clock.tickAsync(ms);
	}

	/**
	 * Run all pending timers
	 */
	runAll(): void {
		this.clock.runAll();
	}

	/**
	 * Run all pending timers asynchronously
	 */
	async runAllAsync(): Promise<void> {
		await this.clock.runAllAsync();
	}

	/**
	 * Run only currently scheduled timers
	 */
	runToLast(): void {
		this.clock.runToLast();
	}

	/**
	 * Run only currently scheduled timers asynchronously
	 */
	async runToLastAsync(): Promise<void> {
		await this.clock.runToLastAsync();
	}

	/**
	 * Get the current fake time
	 */
	get now(): number {
		return this.clock.now;
	}

	/**
	 * Set the current fake time
	 */
	setSystemTime(time: number | Date): void {
		this.clock.setSystemTime(time);
	}

	/**
	 * Restore the real timers
	 */
	restore(): void {
		this.clock.restore();
	}

	/**
	 * Jump forward in time
	 */
	jump(ms: number): void {
		this.clock.jump(ms);
	}

	/**
	 * Get count of pending timers
	 */
	countTimers(): number {
		return this.clock.countTimers();
	}
}

/**
 * Create a test clock instance
 */
export function createTestClock(now?: number | Date): TestClock {
	return new TestClock(now);
}

/**
 * Run a test with fake timers and automatically restore them
 */
export async function withFakeTimers<T>(
	fn: (clock: TestClock) => Promise<T> | T,
	now?: number | Date,
): Promise<T> {
	const clock = createTestClock(now);
	try {
		return await fn(clock);
	} finally {
		clock.restore();
	}
}

/**
 * Helper to wait for a specific amount of fake time
 */
export async function advanceTime(clock: TestClock, ms: number): Promise<void> {
	await clock.tickAsync(ms);
}

/**
 * Helper to advance time in steps
 */
export async function advanceTimeInSteps(
	clock: TestClock,
	totalMs: number,
	stepMs: number,
	callback?: (elapsed: number) => void | Promise<void>,
): Promise<void> {
	let elapsed = 0;
	while (elapsed < totalMs) {
		const step = Math.min(stepMs, totalMs - elapsed);
		await clock.tickAsync(step);
		elapsed += step;
		if (callback) {
			await callback(elapsed);
		}
	}
}

/**
 * Helper to run all timers and wait for promises to settle
 */
export async function flushTimers(clock: TestClock): Promise<void> {
	await clock.runAllAsync();
	// Give microtasks a chance to run
	await new Promise((resolve) => setImmediate(resolve));
}
