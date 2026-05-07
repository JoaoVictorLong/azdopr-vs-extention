import * as vscode from "vscode";

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
}

export class Logger {
	private static _instance: Logger | undefined;
	private outputChannel: vscode.OutputChannel;
	private logLevel: LogLevel = LogLevel.INFO;

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel("Azure DevOps PR Viewer");
	}

	public static getInstance(): Logger {
		if (!Logger._instance) {
			Logger._instance = new Logger();
		}
		return Logger._instance;
	}

	public setLogLevel(level: LogLevel): void {
		this.logLevel = level;
	}

	public show(): void {
		this.outputChannel.show();
	}

	public debug(message: string, ...args: unknown[]): void {
		if (this.logLevel <= LogLevel.DEBUG) {
			this.log("DEBUG", message, ...args);
		}
	}

	public info(message: string, ...args: unknown[]): void {
		if (this.logLevel <= LogLevel.INFO) {
			this.log("INFO", message, ...args);
		}
	}

	public warn(message: string, ...args: unknown[]): void {
		if (this.logLevel <= LogLevel.WARN) {
			this.log("WARN", message, ...args);
		}
	}

	public error(message: string, error?: unknown): void {
		if (this.logLevel <= LogLevel.ERROR) {
			const errorDetails = error instanceof Error ? error.message : String(error);
			const stackTrace = error instanceof Error && error.stack ? `\n${error.stack}` : "";
			this.log("ERROR", `${message}: ${errorDetails}${stackTrace}`);
		}
	}

	private log(level: string, message: string, ...args: unknown[]): void {
		const timestamp = new Date().toISOString();
		const formattedArgs = args.length > 0 ? ` ${JSON.stringify(args)}` : "";
		this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}${formattedArgs}`);
	}

	public clear(): void {
		this.outputChannel.clear();
	}

	public dispose(): void {
		this.outputChannel.dispose();
	}
}
