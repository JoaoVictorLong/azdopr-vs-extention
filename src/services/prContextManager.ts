import * as vscode from "vscode";
import type { PullRequest } from "./azureDevOpsClient";

/**
 * Extended context information for PR files in diff views
 */
export interface PRFileContext {
	pullRequest: PullRequest;
	/** The actual file path in the repository (e.g., "/src/file.ts") */
	filePath: string;
	/** Whether this is the base (left) or modified (right) side of the diff */
	side: "base" | "modified";
	/** The change type (add, delete, edit) */
	changeType: string;
}

/**
 * Manages the context of which PR a file belongs to when viewing files from the PR viewer.
 * This allows us to associate editor actions (like adding comments) with the correct PR.
 */
export class PRContextManager {
	private static instance: PRContextManager;
	private currentPR: PullRequest | undefined;
	private readonly filePathToPRMap: Map<string, PullRequest> = new Map();
	private readonly fileContextMap: Map<string, PRFileContext> = new Map();

	private constructor() {}

	public static getInstance(): PRContextManager {
		if (!PRContextManager.instance) {
			PRContextManager.instance = new PRContextManager();
		}
		return PRContextManager.instance;
	}

	/**
	 * Set the current active PR context
	 */
	public setCurrentPR(pr: PullRequest): void {
		this.currentPR = pr;
	}

	/**
	 * Get the current active PR context
	 */
	public getCurrentPR(): PullRequest | undefined {
		return this.currentPR;
	}

	/**
	 * Associate a file path with a PR (legacy method)
	 */
	public setFileContext(filePath: string, pr: PullRequest): void {
		this.filePathToPRMap.set(filePath, pr);
	}

	/**
	 * Associate a file URI with detailed PR context information
	 */
	public setPRFileContext(uri: vscode.Uri, context: PRFileContext): void {
		const uriString = uri.toString();
		this.fileContextMap.set(uriString, context);
		this.filePathToPRMap.set(uriString, context.pullRequest);
	}

	/**
	 * Get the detailed PR file context for a URI
	 */
	public getPRFileContext(uri: vscode.Uri): PRFileContext | undefined {
		return this.fileContextMap.get(uri.toString());
	}

	/**
	 * Get the PR associated with a file path
	 */
	public getPRForFile(filePath: string): PullRequest | undefined {
		return this.filePathToPRMap.get(filePath);
	}

	/**
	 * Get the PR context for the currently active editor
	 * First checks if the active file has an associated PR, then falls back to current PR
	 */
	public getPRForActiveEditor(): PullRequest | undefined {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			const uriString = activeEditor.document.uri.toString();
			const context = this.fileContextMap.get(uriString);
			if (context) {
				return context.pullRequest;
			}

			const filePath = activeEditor.document.uri.fsPath;
			const prForFile = this.getPRForFile(filePath);
			if (prForFile) {
				return prForFile;
			}
		}
		return this.currentPR;
	}

	/**
	 * Get the PR file context for the currently active editor
	 */
	public getPRFileContextForActiveEditor(): PRFileContext | undefined {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			return this.getPRFileContext(activeEditor.document.uri);
		}
		return undefined;
	}

	/**
	 * Clear all PR context
	 */
	public clear(): void {
		this.currentPR = undefined;
		this.filePathToPRMap.clear();
		this.fileContextMap.clear();
	}

	/**
	 * Clear context for a specific file
	 * Accepts either a file path string or a URI
	 */
	public clearFileContext(filePathOrUri: string | vscode.Uri): void {
		const key = typeof filePathOrUri === "string"
			? filePathOrUri
			: filePathOrUri.toString();

		this.filePathToPRMap.delete(key);
		this.fileContextMap.delete(key);
	}
}
