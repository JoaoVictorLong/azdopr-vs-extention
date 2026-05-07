export function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return `[Non-Error type thrown: ${typeof error}]`;
}

export function formatErrorWithPrefix(prefix: string, error: unknown): string {
	return `${prefix}: ${formatErrorMessage(error)}`;
}
