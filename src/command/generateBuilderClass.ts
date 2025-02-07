import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextDocumentIdentifier, Position, TextDocumentPositionParams } from 'vscode-languageclient';
import { Range, SymbolKind } from "vscode-languageclient";
import path from 'path';

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

let cancelTokenSource: vscode.CancellationTokenSource | undefined;

export async function generateBuilderClass() {
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

            const builderClassName = `${targetClassName}Builder`;
            const builderClassFullName = `${mainClass.packageName}.jfxbuilder.${builderClassName}`;
            // 既存のimport文をチェック
            const documentText = editor.document.getText();
            const importPattern = new RegExp(`^import\\s+${builderClassFullName};`, 'm');

            if (!importPattern.test(documentText)) {
                // package行を探す
                const packageMatch = documentText.match(/^package\s+[^;]+;/m);

                if (packageMatch) {
                    const packageEndPos = editor.document.positionAt(packageMatch.index! + packageMatch[0].length);
                    // package行の後にimport文を追加
                    edit.insert(editor.document.uri, new vscode.Position(packageEndPos.line + 1, 0),
                        `\nimport ${builderClassFullName};\n`);

                }
            }


            // new TargetClassName を new TargetClassNameBuilder に置換
            const range = new vscode.Range(
                cursorPosition.line,
                startPos + 4,
                cursorPosition.line,
                startPos + 4 + targetClassName.length
            );
            edit.replace(editor.document.uri, range, `${builderClassName}`);
            await vscode.workspace.applyEdit(edit);
        }


        await createBuilderClass(methodInfoList, mainClass, targetClassName);
    } else {
        console.log('メインクラスが見つかりません。');
    }
}

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