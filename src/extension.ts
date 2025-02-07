import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextDocumentIdentifier, Position, TextDocumentPositionParams } from 'vscode-languageclient';
import { Range, SymbolKind } from "vscode-languageclient";
import path from 'path';
import * as os from 'os';

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

interface MethodInfo {
	methodName: string;
	className: string;
	dataTypeList: string[];
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

class BuilderClassCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	constructor() {
		// カーソル位置が変更されたときにCodeLensを更新
		vscode.window.onDidChangeTextEditorSelection(() => {
			this._onDidChangeCodeLenses.fire();
		});
	}

	async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document !== document) {
			return [];
		}


		const cursorPosition = editor.selection.active;
		const cursorLine = editor.selection.active.line;
		// カーソル行の内容
		const cursorLineText = document.lineAt(cursorLine).text;
		if (!cursorLineText.includes(' new ')) {
			return [];
		}

		// カーソル位置の前後の文字を取得
		const textBeforeCursor = document.getText(new vscode.Range(
			cursorPosition.line,
			Math.max(0, cursorPosition.character - 1),
			cursorPosition.line,
			cursorPosition.character
		));
		const textAfterCursor = document.getText(new vscode.Range(
			cursorPosition.line,
			cursorPosition.character,
			cursorPosition.line,
			cursorPosition.character + 1
		));

		// アルファベットまたは数字かどうかを判定する正規表現
		const alphaNumericPattern = /[a-zA-Z0-9]/;

		// カーソル位置の前後のいずれかの文字がアルファベットまたは数字であるかを判定
		if (!alphaNumericPattern.test(textBeforeCursor) && !alphaNumericPattern.test(textAfterCursor)) {
			return [];
		}

		// 上記のチェック後でないと、vscode.executeTypeDefinitionProviderでワーニングが出る。

		// カーソル位置の型定義を取得
		const typeDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeTypeDefinitionProvider',
			document.uri,
			cursorPosition
		);

		// javafx.scene.* のクラスのnewが見つかった場合のみCodeLensを表示
		if (typeDefinitions && typeDefinitions.length > 0
			&& typeDefinitions[0].uri.path.includes('javafx.scene.')
		) {
			const range = new vscode.Range(
				cursorLine,
				0,
				cursorLine,
				0
			);

			return [new vscode.CodeLens(range, {
				title: 'Generate Builder Class',
				command: 'javafx-controller-support.generateBuilderClass'
			})];
		}

		return [];

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
		vscode.commands.registerCommand('javafx-controller-support.generateBuilderClass', async () => {
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
			const maxDepth = 100;
			try {
				lspItem = await vscode.commands.executeCommand(
					'java.execute.workspaceCommand',
					'java.navigate.openTypeHierarchy',
					JSON.stringify(params), JSON.stringify(direction), JSON.stringify(maxDepth), cancelTokenSource.token);
			} catch (e) {
				// operation cancelled
				return;
			}

			const targetClassFullName = lspItem.detail + '.' + lspItem.name;
			const targetClassName = lspItem.name;

			if (!lspItem) {
				vscode.window.showInformationMessage('クラスが見つかりません。');
				return;
			}

			const processedClasses = new Set<string>();
			const classQueue: LSPTypeHierarchyItem[] = [lspItem];
			const methodMap = new Map<string, MethodInfo>();

			// キューを使用してクラス階層を処理
			while (classQueue.length > 0) {
				const currentItem = classQueue.shift()!;
				const classKey = `${currentItem.uri}#${currentItem.name}`;

				// 処理済みのクラスはスキップ
				if (processedClasses.has(classKey)) {
					continue;
				}
				processedClasses.add(classKey);

				// シンボル情報を取得
				const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
					'vscode.executeDocumentSymbolProvider',
					vscode.Uri.parse(currentItem.uri)
				);

				if (symbols) {
					const classSymbol = symbols.find(symbol =>
						symbol.kind === vscode.SymbolKind.Class &&
						symbol.name === currentItem.name
					);

					if (classSymbol) {
						// console.log('classSymbol', classSymbol.children[0]);
						// setterメソッドを収集
						classSymbol.children
							.filter(symbol =>
								symbol.kind === vscode.SymbolKind.Method &&
								symbol.name.startsWith('set')
							)
							.forEach(symbol => {
								// メソッド名とパラメータを分離
								const methodMatch = symbol.name.match(/^(set\w+)\((.*)\)/);
								if (methodMatch) {
									const [, methodName, params] = methodMatch;

									// ジェネリック型のパラメータを処理する関数
									function processGenericTypes(text: string): string[] {
										const result: string[] = [];
										let depth = 0;
										let current = '';
										let inGeneric = false;

										for (let i = 0; i < text.length; i++) {
											const char = text[i];
											if (char === '<') {
												depth++;
												inGeneric = true;
												current += char;
											}
											else if (char === '>') {
												depth--;
												current += char;
												if (depth === 0) {
													inGeneric = false;
												}
											}
											else if (char === ',' && !inGeneric) {
												if (current.trim()) {
													result.push(current.trim());
												}
												current = '';
											}
											else {
												current += char;
											}
										}
										if (current.trim()) {
											result.push(current.trim());
										}
										return result;
									}

									// パラメータをジェネリック型を考慮して分割
									const dataTypeList = processGenericTypes(params);

									// メソッド名から'set'を除いて小文字にしたものをキーとして使用
									const key = methodName.substring(3).charAt(0).toLowerCase() +
										methodName.substring(4);

									// まだ登録されていないメソッドのみを追加（親クラスのメソッドは無視）
									if (!methodMap.has(key)) {
										// Deprecatedの処理
										const deprecated = ['LayoutFlags', 'ParentTraversalEngine'];
										// 引数のデータ型にdeprecatedが含まれる場合は、スキップ
										if (dataTypeList.some(type => deprecated.some(d => type.includes(d)))) {
											return;
										}

										methodMap.set(key, {
											methodName,
											className: currentItem.name,
											dataTypeList
										});
									}
								}
							});
					}
				}

				// 親クラスをキューに追加
				if (currentItem.parents && currentItem.parents.length > 0) {
					classQueue.push(...currentItem.parents);
				}
			}

			// Map から配列に変換
			const methodInfoList = Array.from(methodMap.values());

			if (methodInfoList.length > 0) {
				// console.log('継承を含むsetterメソッド一覧:');
				methodInfoList
					.sort((a, b) => a.methodName.localeCompare(b.methodName))
					.forEach(info => {
						const paramTypes = info.dataTypeList.length > 0
							? `(${info.dataTypeList.join(', ')})`
							: '()';
						const paramPairs = info.dataTypeList.map((type, index) => {
							if (info.methodName === 'setMaxSize' || info.methodName === 'setMinSize') {
								return index === 0 ? `${type} width` : `${type} height`;
							}
							return info.dataTypeList.length === 1 ? `${type} value` : `${type} value${index + 1}`;
						});
						const paramNames = paramPairs.map((pair, index) => {
							if (info.methodName === 'setMaxSize' || info.methodName === 'setMinSize') {
								return index === 0 ? 'width' : 'height';
							}
							return info.dataTypeList.length === 1 ? 'value' : `value${index + 1}`;
						}).join(', ');
						// console.log(`- ${info.methodName}(${paramNames})${paramTypes} (定義: ${info.className})`);
					});
			} else {
				console.log('setterメソッドが見つかりません。');
			}

			const currentFileUri = vscode.Uri.parse(document.uri.toString());
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentFileUri);
			if (!workspaceFolder) {
				console.error('ワークスペースフォルダが見つかりません。');
				return;
			}

			const mainClass = await findMainClass(workspaceFolder);
			if (mainClass) {
				console.log(`メインクラスのパス: ${mainClass.filePath}`);

				// カーソル行の new TargetClassName を new TargetClassNameBuilder に置換
				const line = editor.document.lineAt(cursorPosition.line).text;
				const newPattern = new RegExp(`new\\s+${targetClassName}\\s*\\(`);
				const match = line.match(newPattern);
				if (match) {
					const startPos = match.index!;
					const edit = new vscode.WorkspaceEdit();

					// 既存のimport文をチェック
					const documentText = editor.document.getText();
					const importPattern = new RegExp(`^import\\s+${targetClassFullName};`, 'm');
					if (!importPattern.test(documentText)) {
						// package行を探す
						const packageMatch = documentText.match(/^package\s+[^;]+;/m);
						if (packageMatch) {
							const packageEndPos = editor.document.positionAt(packageMatch.index! + packageMatch[0].length);
							// package行の後にimport文を追加
							edit.insert(editor.document.uri, new vscode.Position(packageEndPos.line + 1, 0),
								`\nimport ${targetClassFullName};\n`);
						}
					}

					// new TargetClassName を new TargetClassNameBuilder に置換
					const range = new vscode.Range(
						cursorPosition.line,
						startPos + 4,
						cursorPosition.line,
						startPos + 4 + targetClassName.length
					);
					edit.replace(editor.document.uri, range, `${targetClassName}Builder`);
					await vscode.workspace.applyEdit(edit);
				}

				await createBuilderClass(methodInfoList, mainClass, targetClassName);
			} else {
				console.log('メインクラスが見つかりません。');
			}


		})
	);

	context.subscriptions.push(fxmlWatcher);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: 'java', scheme: 'file' },
			new BuilderClassCodeLensProvider()
		)
	);
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

async function findMainClass(workspaceFolder: vscode.WorkspaceFolder): Promise<{ packageName: string, filePath: string } | null> {
	const pattern = new vscode.RelativePattern(workspaceFolder, 'src/**/*.java');
	const files = await vscode.workspace.findFiles(pattern);

	for (const file of files) {
		try {
			const document = await vscode.workspace.openTextDocument(file);
			const content = document.getText();

			const packageMatch = content.match(/package\s+([^;]+);/);
			if (packageMatch) {
				const packageName = packageMatch[1].trim();
				const applicationPattern = /class\s+\w+\s+extends\s+(?:javafx\.application\.)?(Application)/;
				if (applicationPattern.test(content)) {
					return { packageName, filePath: file.fsPath };
				}
			}
		}
		catch (e) {
			console.error(`Error processing file ${file.fsPath}:`, e);
			continue;
		}
	}

	return null;
}

async function createBuilderClass(methodInfoList: MethodInfo[], mainClass: { packageName: string, filePath: string }, targetClassName: string) {
	const mainClassPath = mainClass.filePath;
	const mainClassDir = mainClassPath.substring(0, mainClassPath.lastIndexOf(path.sep));

	// jfxbuilderフォルダのパスを作成
	const builderDirPath = `${mainClassDir}/jfxbuilder`;
	const builderFilePath = `${builderDirPath}/${targetClassName}Builder.java`;

	try {
		// Builderメソッドを生成
		const builderMethods = methodInfoList
			.map(info => {
				const methodName = info.methodName.substring(3); // 'set'を除去
				const firstChar = methodName.charAt(0).toLowerCase();
				const builderMethodName = firstChar + methodName.slice(1);
				// パラメータの型と名前のペアを生成


				const paramPairs = info.dataTypeList.map((type, index) => {
					if (info.methodName === 'setMaxSize' || info.methodName === 'setMinSize' || info.methodName === 'setPrefSize') {
						return index === 0 ? `${type} width` : `${type} height`;
					}
					return info.dataTypeList.length === 1 ? `${type} value` : `${type} value${index + 1}`;
				});
				const paramNames = paramPairs.map((pair, index) => {
					if (info.methodName === 'setMaxSize' || info.methodName === 'setMinSize' || info.methodName === 'setPrefSize') {
						return index === 0 ? 'width' : 'height';
					}
					return info.dataTypeList.length === 1 ? 'value' : `value${index + 1}`;
				}).join(', ');

				const paramList = paramPairs.join(', ');



				// パラメータリストに<T>が含まれる場合、ジェネリック型パラメータを追加
				// TODO: Eventに決め打ちしているので良くない	
				const hasGenericType = paramList.includes('<T>');
				const methodSignature = hasGenericType ?
					`    public <T extends Event> ${targetClassName}Builder ${builderMethodName}(${paramList})` :
					`    public ${targetClassName}Builder ${builderMethodName}(${paramList})`;
				return methodSignature + ` { in.${info.methodName}(${paramNames}); return this; }`;
			})
			.join('\n\n');

		// Builderクラスのコードを生成
		let builderCode = `package ${mainClass.packageName}.jfxbuilder;

import javafx.scene.*;
import javafx.scene.layout.*;
import javafx.scene.effect.*;
import javafx.scene.control.*;
import javafx.scene.input.*;
import javafx.scene.text.*;
import javafx.scene.shape.*;
import javafx.scene.paint.*;
import javafx.css.*;
import javafx.event.*;
import javafx.geometry.*;
import javafx.collections.*;
import java.util.*;

public class ${targetClassName}Builder {
    private ${targetClassName} in;

    public ${targetClassName}Builder() { in = new ${targetClassName}(); }

${builderMethods}

    public ${targetClassName} build() { return in; }
}
`;

		// フォルダが存在しない場合は作成
		if (!fs.existsSync(builderDirPath)) {
			fs.mkdirSync(builderDirPath);
		}

		// ファイルを作成
		fs.writeFileSync(builderFilePath, builderCode);
		console.log(`Builderクラスを作成しました: ${builderFilePath}`);

		// 0.5秒おきに20回診断を実行
		for (let i = 0; i < 20; i++) {
			await new Promise(resolve => setTimeout(resolve, 500));
			const diagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(builderFilePath));
			if (diagnostics.length > 0) {
				// Diagnosticsがある行をコメントアウト
				const lines = builderCode.split('\n');
				diagnostics.forEach(diagnostic => {
					const lineNumber = diagnostic.range.start.line;
					if (diagnostic.code === '67108965') { // not visible
						lines[lineNumber] = '';
					}
					if (diagnostic.code === '268435844') { // never used
						lines[lineNumber] = '';
					}
				});


				// 空行を削除

				builderCode = lines
					.filter(line => !line.trim().startsWith('//'))
					.join('\n');

				fs.writeFileSync(builderFilePath, builderCode);
			}
		}
		builderCode = builderCode.replace(/\n+/g, '\n');
		fs.writeFileSync(builderFilePath, builderCode);
	} catch (error) {
		console.error('Builderクラスの作成に失敗しました:', error);
	}
}

