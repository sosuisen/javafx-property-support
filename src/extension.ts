import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type FxmlFileInfo = {
	workspaceFolder: vscode.WorkspaceFolder;
	fullPath: string;
}

type TagAndFxId = {
	tagName: string;
	fxId: string;
}

type FxmlData = FxmlFileInfo & {
	controllerFilePath: string | null,
	controllerClassName: string | null,
	tagAndFxIds: Array<TagAndFxId>
}

// key is the full path to the fxml file
const fxmlDictionary: Record<string, FxmlData> = {};

function getControllerFilePath(
	controllerClassName: string,
	workspaceRoot: vscode.Uri
): string {
	// com.example.FooController → com/example/FooController.java
	const parts = controllerClassName.split('.');
	const fileName = parts.pop() + '.java';
	const dirPath = parts.join('/');

	// /path_to_workspace/src/main/java/com/example/FooController.java
	const fullUrl = vscode.Uri.joinPath(workspaceRoot, 'src', 'main', 'java', dirPath, fileName);
	return fullUrl.fsPath;
}

function hasFxIdField(javaText: string, fxId: string): boolean {
	const pattern = new RegExp(`@FXML\\s+private\\s+\\S+\\s+${fxId}\\s*;`);
	return pattern.test(javaText);
}

function parseFxmlFile(fxmlFileInfo: FxmlFileInfo): FxmlData {
	const fxmlContent = fs.readFileSync(fxmlFileInfo.fullPath, 'utf-8');
	const fxIdRegex = /<(\w+)[^>]*fx:id\s*=\s*"([^"]+)"/g;

	const tagAndFxIds: Array<TagAndFxId> = [];

	let match;
	// g flag is used to find all matches
	while ((match = fxIdRegex.exec(fxmlContent)) !== null) {
		const tagName = match[1];
		const fxId = match[2];
		tagAndFxIds.push({ tagName, fxId });
	}

	const controllerRegex = /fx:controller\s*=\s*"([^"]+)"/;
	const controllerMatch = controllerRegex.exec(fxmlContent);
	const controllerClassName = controllerMatch ? controllerMatch[1] : null;
	let controllerFilePath: string | null = null;
	if (controllerClassName) {
		controllerFilePath = getControllerFilePath(controllerClassName, fxmlFileInfo.workspaceFolder.uri);
	}

	return { ...fxmlFileInfo, controllerClassName, controllerFilePath, tagAndFxIds };
}

function handleFxmlChange(uri: vscode.Uri) {
	const fileFullPath = uri.fsPath;

	try {
		fxmlDictionary[fileFullPath] = parseFxmlFile({ workspaceFolder: fxmlDictionary[fileFullPath].workspaceFolder, fullPath: fileFullPath });
	} catch (error) {
		console.error(`Error parsing FXML file ${fileFullPath}:`, error);
	}
}

function calculateIndentation(document: vscode.TextDocument, startLine: number, endLine: number): string {
	const editorConfig = vscode.workspace.getConfiguration('editor');
	const insertSpaces = editorConfig.get<boolean>('insertSpaces', true);
	const tabSize = editorConfig.get<number>('tabSize', 4);
	const defaultIndent = insertSpaces ? ' '.repeat(tabSize) : '\t';

	const lines = document.getText().split('\n').slice(startLine, endLine);
	const indents = lines
		.map(line => line.match(/^[ \t]*/)?.[0].length || 0)
		.filter(indent => indent > 0);

	const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
	const unit = insertSpaces ? ' ' : '\t';
	return minIndent > 0 ? unit.repeat(minIndent) : defaultIndent;
}

function insertFieldWithIndent(
	document: vscode.TextDocument,
	edit: vscode.WorkspaceEdit,
	insertLine: number,
	tagName: string,
	fxId: string
) {
	const indentUnit = calculateIndentation(document, insertLine, insertLine + 3);
	const insertPosition = new vscode.Position(insertLine, 0);
	const fieldDeclaration = `${indentUnit}@FXML\n${indentUnit}private ${tagName} ${fxId};\n\n`;
	edit.insert(document.uri, insertPosition, fieldDeclaration);
}

function getTagNameFromFxId(fxmlData: FxmlData, fxId: string): string {
	const tagAndFxId = fxmlData.tagAndFxIds.find(pair => pair.fxId === fxId);
	if (tagAndFxId) {
		return tagAndFxId.tagName;
	}
	return "Node";
}

class MissingFxIdProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): vscode.CodeAction[] | undefined {
		return context.diagnostics
			.filter(diagnostic => diagnostic.message.startsWith('Missing @FXML field for fx:id='))
			.map(diagnostic => this.createFix(document, diagnostic));
	}

	private createFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
		const fxIdMatch = diagnostic.message.match(/fx:id="([^"]+)"/);
		const fxId = fxIdMatch ? fxIdMatch[1] : 'unknown';

		const fix = new vscode.CodeAction(`Add @FXML field for ${fxId}`, vscode.CodeActionKind.QuickFix);

		const fxmlPath = getFxmlByControllerUri(document.uri);
		if (!fxmlPath) {
			console.error(`No corresponding FXML file found for ${document.uri.fsPath}`);
			return fix;
		}
		const fxmlData = fxmlDictionary[fxmlPath];
		const tagName = getTagNameFromFxId(fxmlData, fxId);

		fix.edit = new vscode.WorkspaceEdit();

		insertFieldWithIndent(document, fix.edit, diagnostic.range.start.line, tagName, fxId);

		fix.diagnostics = [diagnostic];
		fix.isPreferred = true;
		return fix;
	}
}

function getFxmlByControllerUri(uri: vscode.Uri): string | null {
	for (const [fxmlPath, data] of Object.entries(fxmlDictionary)) {
		if (data.controllerFilePath === uri.fsPath) {
			return fxmlPath;
		}
	}
	return null;
}

function findMissingTagAndFxIds(javaText: string, fxmlPath: string): TagAndFxId[] {
	const missings: TagAndFxId[] = [];
	const fxmlData = fxmlDictionary[fxmlPath];
	if (fxmlData) {
		fxmlData.tagAndFxIds.forEach(pair => {
			if (!hasFxIdField(javaText, pair.fxId)) {
				missings.push(pair);
			}
		});
	}
	return missings;
}


function findClassDeclarationLine(javaText: string): number {
	const lines = javaText.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes('class ')) {
			return i;
		}
	}
	return -1;
}

function findClassEndLine(javaText: string): number {
	const lines = javaText.split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].trim() === '}') {
			return i;
		}
	}
	return -1;
}

class MissingFxIdLensProvider implements vscode.CodeLensProvider {
	private workspaceRoot: vscode.Uri;

	constructor(workspaceRoot: vscode.Uri) {
		this.workspaceRoot = workspaceRoot;
	}

	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
		const lenses: vscode.CodeLens[] = [];
		const javaText = document.getText();

		const fxmlPath = getFxmlByControllerUri(document.uri);
		if (fxmlPath) {
			const missingTagAndFxIds = findMissingTagAndFxIds(javaText, fxmlPath);

			if (missingTagAndFxIds.length > 0) {
				const classDeclarationLine = findClassDeclarationLine(javaText);
				if (classDeclarationLine !== -1) {
					const range = new vscode.Range(classDeclarationLine + 1, 0, classDeclarationLine + 1, 0);
					const command: vscode.Command = {
						title: `Add all missing @FXML fields (${missingTagAndFxIds.length})`,
						command: 'javafx-controller-support.addAllMissingFxIds',
						arguments: [document, missingTagAndFxIds]
					};
					lenses.push(new vscode.CodeLens(range, command));
				}
			}

			if (!this.hasInitializeMethod(javaText)) {
				const classEndLine = findClassEndLine(javaText);
				if (classEndLine !== -1) {
					const range = new vscode.Range(classEndLine, 0, classEndLine, 0);
					const command: vscode.Command = {
						title: "Add public void initialize() method",
						command: 'javafx-controller-support.addInitializeMethod',
						arguments: [document, classEndLine]
					};
					lenses.push(new vscode.CodeLens(range, command));
				}
			}
		}

		return lenses;
	}

	private hasInitializeMethod(javaText: string): boolean {
		const initializePattern = /public\s+void\s+initialize\s*\(/;
		return initializePattern.test(javaText);
	}
}

// This method is called when the extension is activated
export function activate(context: vscode.ExtensionContext) {

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		console.error('No workspace folder is open.');
		return;
	}
	const fxmlFileInfos: FxmlFileInfo[] = [];

	function findFxmlFiles(wsFolder: vscode.WorkspaceFolder, srcDir: string) {
		const dirs: string[] = [srcDir];
		while (dirs.length > 0) {
			const currentDir = dirs.pop()!;
			const files = fs.readdirSync(currentDir);
			for (const file of files) {
				const fullPath = path.join(currentDir, file);
				const stat = fs.statSync(fullPath);
				if (stat.isDirectory()) {
					dirs.push(fullPath);
				} else if (file.endsWith('.fxml')) {
					fxmlFileInfos.push({
						workspaceFolder: wsFolder,
						fullPath: fullPath
					});
				}
			}
		}
	}

	workspaceFolders.forEach(folder => {
		const srcDir = path.join(folder.uri.fsPath, 'src');
		findFxmlFiles(folder, srcDir);
	});

	fxmlFileInfos.forEach(fxmlFileInfo => {
		fxmlDictionary[fxmlFileInfo.fullPath] = parseFxmlFile(fxmlFileInfo);
	});

	// Create a FileSystemWatcher for *.fxml files
	// .fxml may be in the bin directory. Skip it.
	const fxmlWatcher = vscode.workspace.createFileSystemWatcher('src/**/*.fxml');

	fxmlWatcher.onDidChange(uri => {
		handleFxmlChange(uri);
	});
	fxmlWatcher.onDidCreate(uri => {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		if (!workspaceFolder) {
			return;
		}
		fxmlDictionary[uri.fsPath] = parseFxmlFile({ workspaceFolder, fullPath: uri.fsPath });
	});
	fxmlWatcher.onDidDelete(uri => {
		delete fxmlDictionary[uri.fsPath];
	});

	vscode.workspace.textDocuments.forEach(document => {
		if (document.languageId === 'java') {
			processJavaDocument(document);
		}
	});

	vscode.workspace.onDidOpenTextDocument(document => {
		if (document.languageId === 'java') {
			processJavaDocument(document);
		}
	});

	vscode.workspace.onDidChangeTextDocument(event => {
		const document = event.document;
		if (document.languageId === 'java') {
			processJavaDocument(document);
		}
	});

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('java', new MissingFxIdProvider(), {
			providedCodeActionKinds: MissingFxIdProvider.providedCodeActionKinds
		})
	);

	workspaceFolders.forEach(folder => {
		context.subscriptions.push(
			vscode.languages.registerCodeLensProvider('java', new MissingFxIdLensProvider(folder.uri))
		);
	});


	context.subscriptions.push(
		vscode.commands.registerCommand('javafx-controller-support.addAllMissingFxIds',
			(document: vscode.TextDocument | undefined, missingTagAndFxIds: TagAndFxId[]) => {
				if (!document) {
					const activeEditor = vscode.window.activeTextEditor;
					if (!activeEditor) {
						vscode.window.showErrorMessage('No active editor found.');
						return;
					}
					document = activeEditor.document;
					const fxmlPath = getFxmlByControllerUri(document.uri);
					if (!fxmlPath) {
						vscode.window.showErrorMessage('No corresponding FXML file found.');
						return;
					}
					if (missingTagAndFxIds.length === 0) {
						vscode.window.showInformationMessage('No missing @FXML fields found.');
						return;
					}
				}

				let insertLine = findClassDeclarationLine(document.getText());
				if (insertLine === -1) {
					vscode.window.showErrorMessage('No class declaration found.');
					return;
				}

				const edit = new vscode.WorkspaceEdit();
				missingTagAndFxIds.forEach(tagAndFxId => {
					insertFieldWithIndent(document, edit, insertLine, tagAndFxId.tagName, tagAndFxId.fxId);
				});

				vscode.workspace.applyEdit(edit);
			})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('javafx-controller-support.addInitializeMethod', (document: vscode.TextDocument, classEndLine: number) => {
			if (!document) {
				const activeEditor = vscode.window.activeTextEditor;
				if (!activeEditor) {
					vscode.window.showErrorMessage('No active editor found.');
					return;
				}
				document = activeEditor.document;
				const fxmlPath = getFxmlByControllerUri(document.uri);
				if (!fxmlPath) {
					vscode.window.showErrorMessage('No corresponding FXML file found.');
					return;
				}
				classEndLine = findClassEndLine(document.getText());

			}

			const edit = new vscode.WorkspaceEdit();
			let classLine = findClassDeclarationLine(document.getText());
			const indentUnit = calculateIndentation(document, classLine, classLine + 3);

			const insertPosition = new vscode.Position(classEndLine, 0);
			const initializeMethod = `
${indentUnit}public void initialize() {
${indentUnit}${indentUnit}// Hint: initialize() is called after @FXML fields are injected
${indentUnit}}
`;
			edit.insert(document.uri, insertPosition, initializeMethod);
			vscode.workspace.applyEdit(edit);
		})
	);

	context.subscriptions.push(fxmlWatcher);
}

const diagnosticCollection = vscode.languages.createDiagnosticCollection('fxml');

function processJavaDocument(document: vscode.TextDocument) {
	const openedFilePath = document.uri.fsPath;
	const fxmlPath = getFxmlByControllerUri(document.uri);
	if (fxmlPath) {
		console.log(`## Opened Java file matches fx:controller. FXML: ${fxmlPath}, Controller Path: ${openedFilePath}`);
		const fxmlData = fxmlDictionary[fxmlPath];

		const javaText = document.getText();
		const diagnostics: vscode.Diagnostic[] = [];

		const fxIdPattern = /@FXML\s+private\s+\S+\s+(\w+)\s*;/g;

		let match;
		while ((match = fxIdPattern.exec(javaText)) !== null) {
			const fxId = match[1];
			const fxIdExistsInFxml = fxmlData.tagAndFxIds.some(pair => pair.fxId === fxId);
			if (!fxIdExistsInFxml) {
				const message = `fx:id="${fxId}" does not exist in the FXML file.`;
				const startPos = document.positionAt(match.index);
				const endPos = document.positionAt(match.index + match[0].length);
				const range = new vscode.Range(startPos, endPos);
				const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
				diagnostics.push(diagnostic);
			}
		}

		fxmlData.tagAndFxIds.forEach(pair => {
			if (!hasFxIdField(javaText, pair.fxId)) {
				const message = `Missing @FXML field for fx:id="${pair.fxId}"`;

				let insertLine = findClassDeclarationLine(javaText);
				if (insertLine === -1) {
					return;
				}

				const range = new vscode.Range(insertLine, 0, insertLine, 0);
				const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
				diagnostics.push(diagnostic);
			}
		});

		diagnosticCollection.delete(document.uri);
		diagnosticCollection.set(document.uri, diagnostics);
	}
}

// This method is called when your extension is deactivated
export function deactivate() { }
