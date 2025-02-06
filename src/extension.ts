import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextDocumentIdentifier, Position, TextDocumentPositionParams } from 'vscode-languageclient';
import { Range, SymbolKind } from "vscode-languageclient";

enum TypeHierarchyDirection {
	children,
	parents,
	both
}

class LSPTypeHierarchyItem {
	name!: string;
	detail!: string;
	kind!: SymbolKind;
	deprecated!: boolean;
	uri!: string;
	range!: Range;
	selectionRange!: Range;
	parents!: LSPTypeHierarchyItem[];
	children!: LSPTypeHierarchyItem[];
	data: any;
}

class TypeHierarchyItem {
	name!: string;
	detail!: string;
	kind!: vscode.SymbolKind;
	deprecated!: boolean;
	uri!: string;
	range!: vscode.Range;
	selectionRange!: vscode.Range;
	parents!: TypeHierarchyItem[];
	children!: TypeHierarchyItem[];
	data: any;
	expand!: boolean;
}

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
	const pattern = new RegExp(`@FXML\\s+\\S+\\s+\\S+\\s+${fxId}\\s*;`);
	return pattern.test(javaText);
}

function processFxmlFile(fullPath: string) {
	try {
		const fxmlContent = fs.readFileSync(fullPath, 'utf-8');
		let workspaceFolder: vscode.WorkspaceFolder | undefined;
		if (fxmlDictionary[fullPath]) {
			workspaceFolder = fxmlDictionary[fullPath].workspaceFolder;
		}
		else {
			workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fullPath));
		}
		if (!workspaceFolder) {
			console.error(`No workspace folder found for ${fullPath}`);
			return;
		}

		const controllerRegex = /fx:controller\s*=\s*"([^"]+)"/;
		const controllerMatch = controllerRegex.exec(fxmlContent);
		const controllerClassName = controllerMatch ? controllerMatch[1] : null;
		let controllerFilePath: string | null = null;
		if (controllerClassName) {
			controllerFilePath = getControllerFilePath(controllerClassName, workspaceFolder.uri);
		}
		else {
			console.error(`No fx:controller for ${fullPath}`);
			return;
		}

		const fxIdRegex = /<(\w+)[^>]*fx:id\s*=\s*"([^"]+)"/g;

		const tagAndFxIds: Array<TagAndFxId> = [];

		let match;
		// g flag is used to find all matches
		while ((match = fxIdRegex.exec(fxmlContent)) !== null) {
			const tagName = match[1];
			const fxId = match[2];
			tagAndFxIds.push({ tagName, fxId });
		}

		fxmlDictionary[fullPath] = {
			workspaceFolder,
			fullPath,
			controllerFilePath,
			controllerClassName,
			tagAndFxIds,
		};
	} catch (error) {
		console.error(`Error parsing FXML file ${fullPath}:`, error);
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

		const fxmlPath = getFxmlByControllerFilePath(document.uri.fsPath);
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

function getFxmlByControllerFilePath(fullPath: string): string | null {
	for (const [fxmlPath, data] of Object.entries(fxmlDictionary)) {
		if (data.controllerFilePath === fullPath) {
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

class ControllerSupportLensProvider implements vscode.CodeLensProvider {

	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
		const lenses: vscode.CodeLens[] = [];
		const javaText = document.getText();

		const fxmlPath = getFxmlByControllerFilePath(document.uri.fsPath);
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

function checkAllFxmlFiles() {
	vscode.workspace.findFiles("src/**/*.fxml").then(files => {
		files.forEach(uri => {
			processFxmlFile(uri.fsPath);
		});
	});
}

function checkAllOpenedJavaFiles() {
	vscode.workspace.textDocuments.forEach(document => {
		if (document.languageId === 'java') {
			processJavaFileByTextDocument(document);
		}
	});
}

let cancelTokenSource: vscode.CancellationTokenSource | undefined;

// This method is called when the extension is activated
export function activate(context: vscode.ExtensionContext) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		console.error('No workspace folder is open.');
		return;
	}

	/**
	 * Observe changes of *.fxml files.
	 */
	// Check all *.fxml files.
	checkAllFxmlFiles();
	// *.fxml files may be in the bin directory. Skip them.
	const fxmlWatcher = vscode.workspace.createFileSystemWatcher('src/**/*.fxml');
	// Change of *.fxml file is detected when the file is saved.
	fxmlWatcher.onDidChange(uri => {
		processFxmlFile(uri.fsPath);
		checkAllOpenedJavaFiles();
	});
	fxmlWatcher.onDidCreate(uri => {
		processFxmlFile(uri.fsPath);
		checkAllOpenedJavaFiles();
	});
	fxmlWatcher.onDidDelete(uri => {
		delete fxmlDictionary[uri.fsPath];
		checkAllOpenedJavaFiles();
	});

	/**
	 * Observe changes of *.java files.
	 */
	checkAllOpenedJavaFiles();
	const javaWatcher = vscode.workspace.createFileSystemWatcher('src/**/*.java');
	// Change of *.java file is detected when the file is saved.
	javaWatcher.onDidChange(uri => processJavaFileByPath(uri.fsPath));
	javaWatcher.onDidCreate(uri => processJavaFileByPath(uri.fsPath));
	javaWatcher.onDidDelete(uri => {
		const fxmlPath = getFxmlByControllerFilePath(uri.fsPath);
		if (fxmlPath) {
			delete fxmlDictionary[fxmlPath];
		}
	});

	// A change to the .java file is detected if it is not saved.	
	vscode.workspace.onDidChangeTextDocument(event => {
		const document = event.document;
		if (document.languageId === 'java') {
			processJavaFileByTextDocument(document);
		}
	});


	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('java', new MissingFxIdProvider(), {
			providedCodeActionKinds: MissingFxIdProvider.providedCodeActionKinds
		})
	);


	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('java', new ControllerSupportLensProvider())
	);


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
					const fxmlPath = getFxmlByControllerFilePath(document.uri.fsPath);
					if (!fxmlPath) {
						vscode.window.showErrorMessage('No corresponding FXML file found.');
						return;
					}
					if (missingTagAndFxIds.length === 0) {
						vscode.window.showInformationMessage('No missing @FXML fields found.');
						return;
					}
				}

				let classDeclarationLine = findClassDeclarationLine(document.getText());
				if (classDeclarationLine === -1) {
					vscode.window.showErrorMessage('No class declaration found.');
					return;
				}

				const edit = new vscode.WorkspaceEdit();
				missingTagAndFxIds.forEach(tagAndFxId => {
					insertFieldWithIndent(document, edit, classDeclarationLine + 1, tagAndFxId.tagName, tagAndFxId.fxId);
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
				const fxmlPath = getFxmlByControllerFilePath(document.uri.fsPath);
				if (!fxmlPath) {
					vscode.window.showErrorMessage('No corresponding FXML file found.');
					return;
				}
				classEndLine = findClassEndLine(document.getText());

			}

			const edit = new vscode.WorkspaceEdit();
			let classDeclarationLine = findClassDeclarationLine(document.getText());
			const indentUnit = calculateIndentation(document, classDeclarationLine + 1, classDeclarationLine + 4);

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

	context.subscriptions.push(
		vscode.commands.registerCommand('javafx-controller-support.showMethods', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage('エディタが開かれていません。');
				return;
			}

			if (editor.document.languageId !== 'java') {
				vscode.window.showErrorMessage('Javaファイルではありません。');
				return;
			}

			const cursorPosition = editor.selection.active;
			const document = editor.document;

			const textDocument: TextDocumentIdentifier = TextDocumentIdentifier.create(document.uri.toString());
			const position: Position = Position.create(cursorPosition.line, cursorPosition.character);
			const params: TextDocumentPositionParams = {
				textDocument: textDocument,
				position: position,
			};
			let lspItem: LSPTypeHierarchyItem;
			const direction = TypeHierarchyDirection.parents;
			if (cancelTokenSource) {
				cancelTokenSource.cancel();
			}
			cancelTokenSource = new vscode.CancellationTokenSource();
			try {
				lspItem = await vscode.commands.executeCommand(
					'java.execute.workspaceCommand',
					'java.navigate.openTypeHierarchy',
					JSON.stringify(params), JSON.stringify(direction), JSON.stringify(0), cancelTokenSource.token);
			} catch (e) {
				// operation cancelled
				return;
			}
			console.log(lspItem.parents);


			// 型定義を取得
			const typeDefinition = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
				'vscode.executeTypeDefinitionProvider',
				document.uri,
				cursorPosition
			);

			if (!typeDefinition || typeDefinition.length === 0) {
				vscode.window.showInformationMessage('クラスが見つかりません。');
				return;
			}

			// 最初の型定義を使用（通常は1つのみ）
			const classType = typeDefinition[0];

			console.log(classType);


			// シンボル情報を取得
			const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
				'vscode.executeDocumentSymbolProvider',
				classType.uri
			);

			console.log(symbols);

			if (!symbols) {
				vscode.window.showErrorMessage('シンボル情報を取得できません。');
				return;
			}

			// クラスシンボルを探す（型定義のrangeを使用）
			const classSymbol = symbols.find(symbol =>
				symbol.kind === vscode.SymbolKind.Class &&
				symbol.range.contains(classType.range)
			);

			if (!classSymbol) {
				vscode.window.showInformationMessage('クラスシンボルが見つかりません。');
				return;
			}

			// setから始まるメソッドを収集
			const setterMethods = classSymbol.children
				.filter(symbol =>
					symbol.kind === vscode.SymbolKind.Method &&
					symbol.name.startsWith('set')
				)
				.map(symbol => symbol.name);

			if (setterMethods.length > 0) {
				console.log(`クラス ${classType.name} のsetterメソッド一覧:`);
				setterMethods.sort().forEach(method => console.log(`- ${method}`));
			} else {
				console.log('setterメソッドが見つかりません。');
			}
		})
	);

	context.subscriptions.push(fxmlWatcher);
}

const diagnosticCollection = vscode.languages.createDiagnosticCollection('fxml');

export async function createDocumentFromText(
	content: string,
	language: string = 'plaintext'
): Promise<vscode.TextDocument> {
	const document = await vscode.workspace.openTextDocument({
		content: content,
		language: language
	});
	return document;
}

async function processJavaFileByPath(fullPath: string) {
	const fxmlPath = getFxmlByControllerFilePath(fullPath);
	if (!fxmlPath) { return; }

	const javaText = fs.readFileSync(fullPath, 'utf-8');
	const document = await createDocumentFromText(javaText, 'java');

	processJavaDocument(fxmlPath, document);
}

async function processJavaFileByTextDocument(document: vscode.TextDocument) {
	const fxmlPath = getFxmlByControllerFilePath(document.uri.fsPath);
	if (!fxmlPath) { return; }

	processJavaDocument(fxmlPath, document);
}

function processJavaDocument(fxmlPath: string, document: vscode.TextDocument) {
	const fxmlData = fxmlDictionary[fxmlPath];

	const diagnostics: vscode.Diagnostic[] = [];

	const fxIdPattern = /@FXML\s+\S+\s+\S+\s+(\w+)\s*;/g;
	const javaText = document.getText();
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

			let classDeclarationLine = findClassDeclarationLine(javaText);
			if (classDeclarationLine === -1) {
				return;
			}

			const range = new vscode.Range(classDeclarationLine + 1, 0, classDeclarationLine + 1, 0);
			const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
			diagnostics.push(diagnostic);
		}
	});

	diagnosticCollection.delete(document.uri);
	diagnosticCollection.set(document.uri, diagnostics);
}

// This method is called when your extension is deactivated
export function deactivate() { }
