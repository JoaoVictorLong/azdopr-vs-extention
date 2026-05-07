import { Logger } from "../../utils/logger";

const logger = Logger.getInstance();

export interface PRContext {
	pullRequestId: number;
	projectId: string;
	repositoryId: string;
	repositoryName?: string;
	filePath: string;
	version: string;
}

export interface LfsFileHandler {
	canHandle(filePath: string, mimeType?: string): boolean;
	displayFile(fileContent: Buffer, filePath: string, prContext: PRContext): Promise<void>;
	getMimeType(filePath: string): string;
	dispose?(): void;
}

/** Handlers are checked in registration order; register specific handlers before generic ones. */
export class FileHandlerRegistry {
	private handlers: LfsFileHandler[] = [];

	register(handler: LfsFileHandler): void {
		this.handlers.push(handler);
	}

	getHandler(filePath: string, mimeType?: string): LfsFileHandler | undefined {
		return this.handlers.find((handler) => handler.canHandle(filePath, mimeType));
	}

	clear(): void {
		for (const handler of this.handlers) {
			if (handler.dispose) {
				try {
					handler.dispose();
				} catch (error) {
					logger.error("FileHandlerRegistry: Error disposing handler", error);
				}
			}
		}
		this.handlers = [];
	}

	dispose(): void {
		this.clear();
	}
}
