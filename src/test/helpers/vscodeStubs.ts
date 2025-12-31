import * as sinon from "sinon";
import type * as vscode from "vscode";

/**
 * Create comprehensive VS Code API stubs for testing
 */
export function createVSCodeStubs() {
	const stubs = {
		authentication: {
			getSession: sinon.stub(),
			onDidChangeSessions: sinon.stub().returns({ dispose: sinon.stub() }),
		},
		window: {
			createOutputChannel: sinon.stub(),
			showErrorMessage: sinon.stub(),
			showInformationMessage: sinon.stub(),
			showWarningMessage: sinon.stub(),
			registerTreeDataProvider: sinon.stub(),
			createTreeView: sinon.stub(),
			activeTextEditor: undefined as vscode.TextEditor | undefined,
			showTextDocument: sinon.stub(),
		},
		workspace: {
			getConfiguration: sinon.stub(),
			onDidChangeConfiguration: sinon.stub().returns({ dispose: sinon.stub() }),
			onDidOpenTextDocument: sinon.stub().returns({ dispose: sinon.stub() }),
			onDidCloseTextDocument: sinon.stub().returns({ dispose: sinon.stub() }),
			openTextDocument: sinon.stub(),
			textDocuments: [] as vscode.TextDocument[],
		},
		commands: {
			registerCommand: sinon.stub().returns({ dispose: sinon.stub() }),
			executeCommand: sinon.stub(),
		},
		comments: {
			createCommentController: sinon.stub(),
		},
		Uri: {
			parse: sinon.stub().callsFake((path: string) => ({ path, scheme: "file" })),
			file: sinon.stub().callsFake((path: string) => ({ path, scheme: "file" })),
		},
		EventEmitter: class<T> {
			private listeners: Array<(e: T) => void> = [];

			get event() {
				return (listener: (e: T) => void) => {
					this.listeners.push(listener);
					return { dispose: () => {} };
				};
			}

			fire(data: T) {
				for (const listener of this.listeners) {
					listener(data);
				}
			}

			dispose() {
				this.listeners = [];
			}
		},
	};

	// Set up default behaviors for commonly used methods
	setupDefaultBehaviors(stubs);

	return stubs;
}

/**
 * Set up default stub behaviors
 */
function setupDefaultBehaviors(stubs: ReturnType<typeof createVSCodeStubs>) {
	// Create output channel returns a mock channel
	stubs.window.createOutputChannel.returns({
		appendLine: sinon.stub(),
		append: sinon.stub(),
		show: sinon.stub(),
		hide: sinon.stub(),
		clear: sinon.stub(),
		dispose: sinon.stub(),
		name: "Test Output",
		replace: sinon.stub(),
	});

	// Get configuration returns a mock configuration object
	stubs.workspace.getConfiguration.returns({
		get: sinon.stub(),
		has: sinon.stub().returns(true),
		inspect: sinon.stub(),
		update: sinon.stub().resolves(),
	});

	// Create comment controller returns a mock controller
	stubs.comments.createCommentController.returns({
		id: "test-comment-controller",
		label: "Test Comments",
		createCommentThread: sinon.stub(),
		dispose: sinon.stub(),
		options: {},
		commentingRangeProvider: undefined,
		reactionHandler: undefined,
	});

	// Auth getSession returns null by default (not signed in)
	stubs.authentication.getSession.resolves(null);
}

/**
 * Reset all VS Code stubs to their default state
 */
export function resetVSCodeStubs(stubs: ReturnType<typeof createVSCodeStubs>) {
	// Reset all authentication stubs
	Object.values(stubs.authentication).forEach((stub) => {
		if (stub && typeof stub.reset === "function") {
			stub.reset();
		}
	});

	// Reset all window stubs
	Object.values(stubs.window).forEach((stub) => {
		if (stub && typeof stub === "object" && "reset" in stub && typeof stub.reset === "function") {
			stub.reset();
		}
	});

	// Reset all workspace stubs
	Object.values(stubs.workspace).forEach((stub) => {
		if (stub && typeof stub === "object" && "reset" in stub && typeof stub.reset === "function") {
			stub.reset();
		}
	});

	// Reset all command stubs
	Object.values(stubs.commands).forEach((stub) => {
		if (stub && typeof stub.reset === "function") {
			stub.reset();
		}
	});

	// Reset all comment stubs
	Object.values(stubs.comments).forEach((stub) => {
		if (stub && typeof stub.reset === "function") {
			stub.reset();
		}
	});

	// Reset all URI stubs
	Object.values(stubs.Uri).forEach((stub) => {
		if (stub && typeof stub.reset === "function") {
			stub.reset();
		}
	});

	// Re-setup default behaviors after reset
	setupDefaultBehaviors(stubs);
}

/**
 * Create a mock VS Code authentication session
 */
export function createMockAuthSession(
	accessToken = "mock-access-token",
	account = {
		id: "test-user-id",
		label: "test.user@example.com",
	},
	// biome-ignore lint/suspicious/noExplicitAny: Test helper returns mock object
): any {
	return {
		id: "test-session-id",
		accessToken,
		account,
		scopes: ["user_impersonation"],
	};
}

/**
 * Create a mock VS Code configuration object
 */
export function createMockConfiguration(
	// biome-ignore lint/suspicious/noExplicitAny: Test helper uses any for flexible mock configuration
	settings: Record<string, any> = {},
	// biome-ignore lint/suspicious/noExplicitAny: Test helper returns mock object
): any {
	return {
		// biome-ignore lint/suspicious/noExplicitAny: Mock accepts any default value
		get: sinon.stub().callsFake((key: string, defaultValue?: any) => {
			return settings[key] !== undefined ? settings[key] : defaultValue;
		}),
		has: sinon.stub().callsFake((key: string) => settings[key] !== undefined),
		inspect: sinon.stub(),
		update: sinon.stub().resolves(),
	};
}

/**
 * Create a mock VS Code extension context
 */
export function createMockExtensionContext(
	storagePath = "/tmp/test-storage",
): Partial<vscode.ExtensionContext> {
	return {
		subscriptions: [],
		globalStorageUri: { fsPath: storagePath, scheme: "file" } as vscode.Uri,
		storageUri: { fsPath: storagePath, scheme: "file" } as vscode.Uri,
		extensionUri: {
			fsPath: "/tmp/test-extension",
			scheme: "file",
		} as vscode.Uri,
		extensionPath: "/tmp/test-extension",
		globalState: {
			get: sinon.stub(),
			update: sinon.stub().resolves(),
			keys: sinon.stub().returns([]),
			setKeysForSync: sinon.stub(),
			// biome-ignore lint/suspicious/noExplicitAny: Partial mock for testing
		} as any,
		workspaceState: {
			get: sinon.stub(),
			update: sinon.stub().resolves(),
			keys: sinon.stub().returns([]),
			// biome-ignore lint/suspicious/noExplicitAny: Partial mock for testing
		} as any,
		secrets: {
			get: sinon.stub(),
			store: sinon.stub().resolves(),
			delete: sinon.stub().resolves(),
			onDidChange: sinon.stub().returns({ dispose: sinon.stub() }),
			// biome-ignore lint/suspicious/noExplicitAny: Partial mock for testing
		} as any,
		// biome-ignore lint/suspicious/noExplicitAny: Partial mock for testing
		extension: {} as any,
		// biome-ignore lint/suspicious/noExplicitAny: Partial mock for testing
		environmentVariableCollection: {} as any,
		extensionMode: 3, // ExtensionMode.Test
		storagePath,
		globalStoragePath: storagePath,
		logPath: "/tmp/test-logs",
		asAbsolutePath: (relativePath: string) => `/tmp/test-extension/${relativePath}`,
		logUri: { fsPath: "/tmp/test-logs", scheme: "file" } as vscode.Uri,
	};
}

/**
 * Create a mock VS Code text document
 */
export function createMockTextDocument(
	uri: string,
	content = "",
	languageId = "typescript",
): Partial<vscode.TextDocument> {
	const lines = content.split("\n");
	const lineAtStub = sinon.stub().callsFake((lineOrPosition: number | vscode.Position) => {
		const lineNumber = typeof lineOrPosition === "number" ? lineOrPosition : lineOrPosition.line;
		return {
			lineNumber,
			text: lines[lineNumber] || "",
			range: {},
			rangeIncludingLineBreak: {},
			firstNonWhitespaceCharacterIndex: 0,
			isEmptyOrWhitespace: false,
		};
	});

	return {
		uri: { path: uri, scheme: "file" } as vscode.Uri,
		fileName: uri,
		isUntitled: false,
		languageId,
		version: 1,
		isDirty: false,
		isClosed: false,
		save: sinon.stub().resolves(true),
		eol: 1, // vscode.EndOfLine.LF
		lineCount: lines.length,
		lineAt: lineAtStub as vscode.TextDocument["lineAt"],
		offsetAt: sinon.stub(),
		positionAt: sinon.stub(),
		getText: sinon.stub().returns(content),
		getWordRangeAtPosition: sinon.stub(),
		validateRange: sinon.stub(),
		validatePosition: sinon.stub(),
	};
}

/**
 * Create a mock VS Code comment thread
 */
export function createMockCommentThread(
	uri: string,
	// biome-ignore lint/suspicious/noExplicitAny: Test helper uses any for flexible mock parameters
	range: any,
	// biome-ignore lint/suspicious/noExplicitAny: Test helper uses any for flexible mock parameters
	comments: any[] = [],
	// biome-ignore lint/suspicious/noExplicitAny: Test helper returns mock object
): any {
	return {
		uri: { path: uri, scheme: "file" },
		range,
		comments,
		collapsibleState: 0, // vscode.CommentThreadCollapsibleState.Collapsed
		canReply: true,
		contextValue: "",
		label: "Test Thread",
		state: 0, // vscode.CommentThreadState.Unresolved
		dispose: sinon.stub(),
	};
}
