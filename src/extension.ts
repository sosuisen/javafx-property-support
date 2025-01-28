// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

function getControllerFilePath(
	controllerClassName: string,
	workspaceRoot: vscode.Uri
): string {
	// com.example.FooController → com/example/FooController.java
	const parts = controllerClassName.split('.');
	const fileName = parts.pop() + '.java';
	const dirPath = parts.join('/');

	// src/main/java/com/example/FooController.java
	const fullPath = vscode.Uri.joinPath(workspaceRoot, 'src', 'main', 'java', dirPath, fileName);
	return fullPath.fsPath;
}

function hasField(javaText: string, fxId: string): boolean {
	const pattern = new RegExp(`@FXML\\s+private\\s+\\S+\\s+${fxId}\\s*;`);
	return pattern.test(javaText);
}


interface FxmlFileInfo {
	workspaceFolder: vscode.WorkspaceFolder;
	path: string;
}


const fxmlData: Record<string, { workspaceFolder: vscode.WorkspaceFolder, controllerFilePath: string | null, controllerClassName: string | null, elements: Array<{ tagName: string, fxId: string }> }> = {};

function parseFxmlFile(fxmlFileInfo: FxmlFileInfo): { controllerFilePath: string | null, controllerClassName: string | null, elements: Array<{ tagName: string, fxId: string }> } {
	const fxmlContent = fs.readFileSync(fxmlFileInfo.path, 'utf-8');
	const fxIdRegex = /<(\w+)[^>]*fx:id\s*=\s*"([^"]+)"/g;
	const controllerRegex = /fx:controller\s*=\s*"([^"]+)"/;

	let match;
	const fileData: Array<{ tagName: string, fxId: string }> = [];

	while ((match = fxIdRegex.exec(fxmlContent)) !== null) {
		const tagName = match[1];
		const fxId = match[2];
		fileData.push({ tagName, fxId });
	}

	const controllerMatch = controllerRegex.exec(fxmlContent);
	const controllerClassName = controllerMatch ? controllerMatch[1] : null;
	let controllerFilePath: string | null = null;
	if (controllerClassName) {
		controllerFilePath = getControllerFilePath(controllerClassName, fxmlFileInfo.workspaceFolder.uri);
	}

	return { controllerClassName, controllerFilePath, elements: fileData };
}

async function handleFxmlChange(uri: vscode.Uri) {
	const filePath = uri.fsPath;

	if (!filePath.includes('src')) {
		console.log(`## Skipping non-src FXML file: ${filePath}`);
		return;
	}

	try {
		const fileData = parseFxmlFile({ workspaceFolder: fxmlData[filePath].workspaceFolder, path: filePath });
		fxmlData[filePath] = {
			workspaceFolder: fxmlData[filePath].workspaceFolder,
			...fileData
		};
	} catch (error) {
		console.error(`Error parsing FXML file ${filePath}:`, error);
	}
}

function calculateIndentation(document: vscode.TextDocument, startLine: number, endLine: number): string {
	const editorConfig = vscode.workspace.getConfiguration('editor', document.uri);
	const insertSpaces = editorConfig.get<boolean>('insertSpaces', true);
	const tabSize = editorConfig.get<number>('tabSize', 4);
	const defaultIndentUnit = insertSpaces ? ' '.repeat(tabSize) : '\t';

	const lines = document.getText().split('\n').slice(startLine, endLine);
	const indents = lines
		.map(line => line.match(/^[ \t]*/)?.[0].length || 0)
		.filter(indent => indent > 0);

	const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
	return minIndent > 0 ? ' '.repeat(minIndent) : defaultIndentUnit;
}

function insertFieldWithIndent(
	document: vscode.TextDocument,
	edit: vscode.WorkspaceEdit,
	insertLine: number,
	tagName: string,
	fxId: string
) {
	const indentUnit = calculateIndentation(document, insertLine, insertLine + 10);
	const insertPosition = new vscode.Position(insertLine, 0);
	const fieldDeclaration = `${indentUnit}@FXML\n${indentUnit}private ${tagName} ${fxId};\n\n`;
	edit.insert(document.uri, insertPosition, fieldDeclaration);
}


function getTagNameFromFxId(fxId: string): string {
	for (const data of Object.values(fxmlData)) {
		const element = data.elements.find(el => el.fxId === fxId);
		if (element) {
			return element.tagName;
		}
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

		const tagName = getTagNameFromFxId(fxId);

		const fix = new vscode.CodeAction(`Add @FXML field for ${fxId}`, vscode.CodeActionKind.QuickFix);
		fix.edit = new vscode.WorkspaceEdit();

		insertFieldWithIndent(document, fix.edit, diagnostic.range.start.line, tagName, fxId);

		fix.diagnostics = [diagnostic];
		fix.isPreferred = true;
		return fix;
	}
}

function getFxmlByControllerUri(uri: vscode.Uri): string | null {
	for (const [fxmlPath, data] of Object.entries(fxmlData)) {
		if (data.controllerClassName) {
			const controllerPath = getControllerFilePath(data.controllerClassName, data.workspaceFolder.uri);
			if (controllerPath === uri.fsPath) {
				return fxmlPath;
			}
		}
	}
	return null;
}

function findMissingFxIds(javaText: string, fxmlPath: string): string[] {
	const missingFxIds: string[] = [];
	const fxmlInfo = fxmlData[fxmlPath];
	if (fxmlInfo) {
		fxmlInfo.elements.forEach(element => {
			if (!hasField(javaText, element.fxId)) {
				missingFxIds.push(element.fxId);
			}
		});
	}
	return missingFxIds;
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
			const missingFxIds = findMissingFxIds(javaText, fxmlPath);

			if (missingFxIds.length > 0) {
				const classDeclarationLine = this.findClassDeclarationLine(javaText);
				if (classDeclarationLine !== -1) {
					const range = new vscode.Range(classDeclarationLine + 1, 0, classDeclarationLine + 1, 0);
					const command: vscode.Command = {
						title: `Add all missing @FXML fields (${missingFxIds.length})`,
						command: 'fxml-controller-support.addAllMissingFxIds',
						arguments: [document, missingFxIds]
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
						command: 'fxml-controller-support.addInitializeMethod',
						arguments: [document, classEndLine]
					};
					lenses.push(new vscode.CodeLens(range, command));
				}
			}
		}

		return lenses;
	}



	private findClassDeclarationLine(javaText: string): number {
		const lines = javaText.split('\n');
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes('class ')) {
				return i;
			}
		}
		return -1;
	}


	private hasInitializeMethod(javaText: string): boolean {
		const initializePattern = /public\s+void\s+initialize\s*\(\s*\)\s*{/;
		return initializePattern.test(javaText);
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		console.error('No workspace folder is open.');
		return;
	}

	interface FxmlFileInfo {
		workspaceFolder: vscode.WorkspaceFolder;
		path: string;
	}

	const fxmlList: FxmlFileInfo[] = [];

	function findFxmlFiles(wsFolder: vscode.WorkspaceFolder, dir: string) {
		const files = fs.readdirSync(dir);
		for (const file of files) {
			const fullPath = path.join(dir, file);
			const stat = fs.statSync(fullPath);
			if (stat.isDirectory()) {
				findFxmlFiles(wsFolder, fullPath);
			} else if (file.endsWith('.fxml') && fullPath.includes('src')) {
				fxmlList.push({
					workspaceFolder: wsFolder,
					path: fullPath
				});
			}
		}
	}

	workspaceFolders.forEach(folder => {
		const srcDir = path.join(folder.uri.fsPath, 'src');
		findFxmlFiles(folder, srcDir);
	});

	fxmlList.forEach(fxmlInfo => {
		fxmlData[fxmlInfo.path] = {
			workspaceFolder: fxmlInfo.workspaceFolder,
			...parseFxmlFile(fxmlInfo)
		};
	});

	// Create a FileSystemWatcher for *.fxml files
	const fxmlWatcher = vscode.workspace.createFileSystemWatcher('**/*.fxml');

	// Register events
	fxmlWatcher.onDidChange(uri => {
		handleFxmlChange(uri);
	});
	fxmlWatcher.onDidCreate(uri => {
		handleFxmlChange(uri);
	});
	fxmlWatcher.onDidDelete(uri => {
		const filePath = uri.fsPath;
		const index = fxmlList.findIndex(item => item.path === filePath);
		if (index !== -1) {
			fxmlList.splice(index, 1);
			delete fxmlData[filePath];
		}
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
		vscode.commands.registerCommand('fxml-controller-support.addAllMissingFxIds', (document: vscode.TextDocument | undefined, missingFxIds: string[]) => {
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
				missingFxIds = findMissingFxIds(document.getText(), fxmlPath);
				if (missingFxIds.length === 0) {
					vscode.window.showInformationMessage('No missing @FXML fields found.');
					return;
				}
			}

			const edit = new vscode.WorkspaceEdit();
			const lines = document.getText().split('\n');
			let insertLine = 0;
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes("class ")) {
					insertLine = i + 1;
					break;
				}
			}

			missingFxIds.forEach(fxId => {
				const tagName = getTagNameFromFxId(fxId);
				insertFieldWithIndent(document, edit, insertLine, tagName, fxId);
			});

			vscode.workspace.applyEdit(edit);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('fxml-controller-support.addInitializeMethod', (document: vscode.TextDocument, classEndLine: number) => {
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
			const indentUnit = calculateIndentation(document, classEndLine - 10, classEndLine);

			const insertPosition = new vscode.Position(classEndLine, 0);
			const initializeMethod = `
${indentUnit}public void initialize() {
${indentUnit}${indentUnit}// TODO: Add initialization logic here
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
		console.log(`## Opened Java file matches fx:controller:`);
		console.log(`FXML Path: ${fxmlPath}`);
		console.log(`Controller Path: ${openedFilePath}`);
		const data = fxmlData[fxmlPath];

		const javaText = document.getText();
		const diagnostics: vscode.Diagnostic[] = [];

		const fxIdPattern = /@FXML\s+private\s+\S+\s+(\w+)\s*;/g;
		let match;
		while ((match = fxIdPattern.exec(javaText)) !== null) {
			const fxId = match[1];
			const fxIdExistsInFxml = data.elements.some(element => element.fxId === fxId);
			if (!fxIdExistsInFxml) {
				const message = `fx:id="${fxId}" does not exist in the FXML file.`;
				const startPos = document.positionAt(match.index);
				const endPos = document.positionAt(match.index + match[0].length);
				const range = new vscode.Range(startPos, endPos);
				const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
				diagnostics.push(diagnostic);
			}
		}

		data.elements.forEach(element => {
			if (!hasField(javaText, element.fxId)) {
				const message = `Missing @FXML field for fx:id="${element.fxId}"`;

				const lines = javaText.split('\n');
				let insertLine = 0;
				for (let i = 0; i < lines.length; i++) {
					if (lines[i].includes("class ")) {
						insertLine = i + 1;
						break;
					}
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


function getWorkspaceFolderForActiveDocument(): vscode.WorkspaceFolder | undefined {
	const activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor) {
		vscode.window.showErrorMessage('No active editor found.');
		return undefined;
	}

	const document = activeEditor.document;

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		return undefined;
	}

	const documentPath = document.uri.fsPath;
	for (const folder of workspaceFolders) {
		if (documentPath.startsWith(folder.uri.fsPath)) {
			return folder;
		}
	}

	return undefined;
}

// This method is called when your extension is deactivated
export function deactivate() { }
