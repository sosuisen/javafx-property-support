// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';



function getControllerJavaUri(
	controllerClassName: string,
	workspaceRoot: vscode.Uri
): vscode.Uri {
	// 例: com.example.FooController → com/example/FooController.java
	const parts = controllerClassName.split('.');
	const fileName = parts.pop() + '.java';
	const dirPath = parts.join('/');

	// src/main/java/com/example/FooController.java のUriを作る例
	const fullPath = vscode.Uri.joinPath(workspaceRoot, 'src', 'main', 'java', dirPath, fileName);
	return fullPath;
}

function hasField(javaText: string, fxId: string): boolean {
	// 例: @FXML (改行や空白が入りうる) private (任意の型) fxId ;
	// 正規表現には注意が必要だが、とりあえず単純に
	const pattern = new RegExp(`@FXML\\s+private\\s+\\S+\\s+${fxId}\\s*;`);
	return pattern.test(javaText);
}


// FXMLファイルのデータを保持するオブジェクトを関数の外に宣言
const fxmlData: Record<string, { controller: string | null, elements: Array<{ tagName: string, fxId: string }> }> = {};

function parseFxmlFile(filePath: string): { controller: string | null, elements: Array<{ tagName: string, fxId: string }> } {
	const fxmlContent = fs.readFileSync(filePath, 'utf-8');
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
	const controller = controllerMatch ? controllerMatch[1] : null;

	return { controller, elements: fileData };
}

async function handleFxmlChange(uri: vscode.Uri) {
	const filePath = uri.fsPath;

	// src以下にないファイルはスキップ
	if (!filePath.includes('src')) {
		console.log(`## Skipping non-src FXML file: ${filePath}`);
		return;
	}

	console.log(`## FXML file changed: ${filePath}`);

	try {
		const fileData = parseFxmlFile(filePath);
		fxmlData[filePath] = fileData;
		console.log(`## Updated FXML Data for ${filePath}:`, fileData);
	} catch (error) {
		console.error(`Error parsing FXML file ${filePath}:`, error);
	}
}

// インデントを計算する関数
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

// インデントを取得してフィールドを挿入する関数
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
	return "Node"; // デフォルトの型
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

		// タグ名を取得するために、fxmlDataからfx:idに対応するタグ名を取得
		const tagName = getTagNameFromFxId(fxId);

		const fix = new vscode.CodeAction(`Add @FXML field for ${fxId}`, vscode.CodeActionKind.QuickFix);
		fix.edit = new vscode.WorkspaceEdit();

		// インデントを取得してフィールドを挿入する
		insertFieldWithIndent(document, fix.edit, diagnostic.range.start.line, tagName, fxId);

		fix.diagnostics = [diagnostic];
		fix.isPreferred = true;
		return fix;
	}

}

class MissingFxIdLensProvider implements vscode.CodeLensProvider {
	private workspaceRoot: vscode.Uri;

	constructor(workspaceRoot: vscode.Uri) {
		this.workspaceRoot = workspaceRoot;
	}

	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
		const lenses: vscode.CodeLens[] = [];
		const javaText = document.getText();

		// 現在のドキュメントがFXMLのControllerに対応しているか確認
		if (this.isControllerDocument(document.uri)) {
			// FXMLに存在するがJava側にないフィールドを探す
			const missingFxIds = this.findMissingFxIds(javaText, document.uri);

			if (missingFxIds.length > 0) {
				// クラス宣言の直後にCodeLensを追加
				const classDeclarationLine = this.findClassDeclarationLine(javaText);
				if (classDeclarationLine !== -1) {
					const range = new vscode.Range(classDeclarationLine + 1, 0, classDeclarationLine + 1, 0);
					const command: vscode.Command = {
						title: `Add all missing @FXML fields (${missingFxIds.length})`,
						command: 'fxml-fxid-support.addAllMissingFxIds',
						arguments: [document, missingFxIds]
					};
					lenses.push(new vscode.CodeLens(range, command));
				}
			}

			// Check if the initialize method is missing
			if (!this.hasInitializeMethod(javaText)) {
				const classEndLine = this.findClassEndLine(javaText);
				if (classEndLine !== -1) {
					const range = new vscode.Range(classEndLine, 0, classEndLine, 0);
					const command: vscode.Command = {
						title: "Add public void initialize() method",
						command: 'fxml-fxid-support.addInitializeMethod',
						arguments: [document, classEndLine]
					};
					lenses.push(new vscode.CodeLens(range, command));
				}
			}
		}

		return lenses;
	}

	private isControllerDocument(uri: vscode.Uri): boolean {
		for (const data of Object.values(fxmlData)) {
			const controllerPath = getControllerJavaUri(data.controller!, this.workspaceRoot).fsPath;
			if (controllerPath === uri.fsPath) {
				return true;
			}
		}
		return false;
	}

	private findMissingFxIds(javaText: string, uri: vscode.Uri): string[] {
		const missingFxIds: string[] = [];
		for (const [fxmlPath, data] of Object.entries(fxmlData)) {
			const controllerPath = uri.fsPath;

			// デバッグ用にパスを出力
			console.log('## FXML Path:', fxmlPath);
			console.log('## Controller Path:', controllerPath);
			console.log('## Current Document Path:', uri.fsPath);

			if (controllerPath === uri.fsPath) {
				data.elements.forEach(element => {
					if (!hasField(javaText, element.fxId)) {
						missingFxIds.push(element.fxId);
					}
				});
			}
		}
		return missingFxIds;
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

	private findClassEndLine(javaText: string): number {
		const lines = javaText.split('\n');
		for (let i = lines.length - 1; i >= 0; i--) {
			if (lines[i].trim() === '}') {
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
	console.log('## activate: fxml-fxid-support');

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		console.error('No workspace folder is open.');
		return;
	}

	const srcDir = path.join(workspaceFolders[0].uri.fsPath, 'src');
	console.log('##	 srcDir:', srcDir);

	const fxmlList: string[] = [];

	function findFxmlFiles(dir: string) {
		const files = fs.readdirSync(dir);
		for (const file of files) {
			const fullPath = path.join(dir, file);
			const stat = fs.statSync(fullPath);
			if (stat.isDirectory()) {
				findFxmlFiles(fullPath);
			} else if (file.endsWith('.fxml') && fullPath.includes('src')) {
				fxmlList.push(fullPath);
			}
		}
	}

	findFxmlFiles(srcDir);

	console.log('## FXML Files:', fxmlList);

	// FXMLファイルをパースしてタグ名とfx:idのペアを記録
	fxmlList.forEach(filePath => {
		fxmlData[filePath] = parseFxmlFile(filePath);
	});

	console.log('## Parsed FXML Data:', fxmlData);

	// 1) FileSystemWatcherを作る (パターンは *.fxml)
	const fxmlWatcher = vscode.workspace.createFileSystemWatcher('**/*.fxml');


	// 2) イベント登録
	fxmlWatcher.onDidChange(uri => {
		handleFxmlChange(uri);
	});
	fxmlWatcher.onDidCreate(uri => {
		handleFxmlChange(uri);
	});
	fxmlWatcher.onDidDelete(uri => {
		const filePath = uri.fsPath;
		console.log(`## FXML file deleted: ${filePath}`);
		const index = fxmlList.indexOf(filePath);
		if (index !== -1) {
			fxmlList.splice(index, 1);
			delete fxmlData[filePath];
			console.log(`## Removed ${filePath} from fxmlList and fxmlData`);
		}
	});

	// 現在開かれているすべてのドキュメントに対して処理を実行
	vscode.workspace.textDocuments.forEach(document => {
		if (document.languageId === 'java') {
			processJavaDocument(document, workspaceFolders[0].uri);
		}
	});

	vscode.workspace.onDidOpenTextDocument(document => {
		if (document.languageId === 'java') {
			processJavaDocument(document, workspaceFolders[0].uri);
		}
	});

	// .javaファイルが変更されたときにprocessJavaDocumentを実行
	vscode.workspace.onDidChangeTextDocument(event => {
		const document = event.document;
		if (document.languageId === 'java') {
			processJavaDocument(document, workspaceFolders[0].uri);
		}
	});

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('java', new MissingFxIdProvider(), {
			providedCodeActionKinds: MissingFxIdProvider.providedCodeActionKinds
		})
	);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('java', new MissingFxIdLensProvider(workspaceFolders[0].uri))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('fxml-fxid-support.addAllMissingFxIds', (document: vscode.TextDocument, missingFxIds: string[]) => {
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
		vscode.commands.registerCommand('fxml-fxid-support.addInitializeMethod', (document: vscode.TextDocument, classEndLine: number) => {
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

// DiagnosticCollectionを関数の外で宣言して、再利用可能にする
const diagnosticCollection = vscode.languages.createDiagnosticCollection('fxml');

function processJavaDocument(document: vscode.TextDocument, workspaceUri: vscode.Uri) {
	const openedFilePath = document.uri.fsPath;
	for (const [fxmlPath, data] of Object.entries(fxmlData)) {
		if (data.controller) {
			const controllerPath = getControllerJavaUri(data.controller, workspaceUri).fsPath;

			// デバッグ用にパスを出力
			console.log('## Controller Path:', controllerPath);
			console.log('## Opened File Path:', openedFilePath);

			if (controllerPath === openedFilePath) {
				console.log(`## Opened Java file matches fx:controller:`);
				console.log(`FXML Path: ${fxmlPath}`);
				console.log(`Controller Path: ${controllerPath}`);

				const javaText = document.getText();
				const diagnostics: vscode.Diagnostic[] = [];

				// FXMLに存在しない@FXIdフィールドの診断を追加
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

				// FXMLに存在しないフィールドの診断を追加
				data.elements.forEach(element => {
					if (!hasField(javaText, element.fxId)) {
						const message = `Missing @FXML field for fx:id="${element.fxId}"`;

						// 推測されるフィールドの位置を決定
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

				// 診断を設定する前に、既存の診断をクリア
				diagnosticCollection.delete(document.uri);
				diagnosticCollection.set(document.uri, diagnostics);
			}
		}
	}
}

// This method is called when your extension is deactivated
export function deactivate() { }
