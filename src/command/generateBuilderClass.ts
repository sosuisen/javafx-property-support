import * as vscode from 'vscode';
import * as fs from 'fs';
import { TextDocumentIdentifier, Position, TextDocumentPositionParams } from 'vscode-languageclient';
import { Range, SymbolKind } from "vscode-languageclient";
import path from 'path';
import { findMainClass } from '../util';

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
        vscode.window.showErrorMessage('No active editor found.');
        return;
    }

    if (editor.document.languageId !== 'java') {
        vscode.window.showErrorMessage('Not a Java file.');
        return;
    }

    const cursorPosition = editor.selection.active;
    const cursorLine = cursorPosition.line;
    const line = editor.document.lineAt(cursorLine).text;

    const constructorPattern = /new\s+([\w.]+)\s*\(/;
    const match = line.match(constructorPattern);
    if (!match) {
        return;
    }
    const targetClassFullName = match[1];
    const classNamePattern = /new\s+[\w.]+?\.(\w+?)\s*\(/;
    const classMatch = line.match(classNamePattern);
    const targetClassNameOnly = classMatch ? classMatch[1] : targetClassFullName;
    const classStartAt = line.indexOf(targetClassNameOnly + "()");
    const classPosition = new vscode.Position(cursorPosition.line, classStartAt + 1);

    const document = editor.document;
    const textDocument: TextDocumentIdentifier = TextDocumentIdentifier.create(document.uri.toString());
    const params: TextDocumentPositionParams = {
        textDocument: textDocument,
        position: classPosition,
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

    // const targetClassFullName = lspItem.detail + '.' + lspItem.name;
    // const targetClassName = lspItem.name;

    if (!lspItem) {
        vscode.window.showInformationMessage('Class not found.');
        return;
    }

    const processedClasses = new Set<string>();
    const classQueue: LSPTypeHierarchyItem[] = [lspItem];
    const methodMap = new Map<string, MethodInfo>();

    // Process class hierarchy using queue
    while (classQueue.length > 0) {
        const currentItem = classQueue.shift()!;
        const classKey = `${currentItem.uri}#${currentItem.name}`;

        // Skip already processed classes
        if (processedClasses.has(classKey)) {
            continue;
        }
        processedClasses.add(classKey);

        // Get symbol information
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
                // Collect setter methods
                classSymbol.children
                    .filter(symbol =>
                        symbol.kind === vscode.SymbolKind.Method &&
                        symbol.name.startsWith('set')
                    )
                    .forEach(symbol => {
                        // Separate method name and parameters
                        const methodMatch = symbol.name.match(/^(set\w+)\((.*)\)/);
                        if (methodMatch) {
                            const [, methodName, params] = methodMatch;
                            const dataTypeList = processGenericTypes(params);

                            // Use lowercase name without 'set' as key
                            const key = methodName.substring(3).charAt(0).toLowerCase() +
                                methodName.substring(4);

                            // Add only methods that haven't been registered yet (ignore parent class methods)
                            if (!methodMap.has(key)) {
                                // Handle deprecated methods
                                const deprecated = ['LayoutFlags', 'ParentTraversalEngine'];
                                // Skip if data type contains deprecated types
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

        // Add parent classes to queue
        if (currentItem.parents && currentItem.parents.length > 0) {
            classQueue.push(...currentItem.parents);
        }
    }

    // Convert Map to array
    const methodInfoList = Array.from(methodMap.values());

    const mainClass = await findMainClass(document.uri);
    if (mainClass) {
        const line = editor.document.lineAt(cursorPosition.line).text;
        const newPattern = new RegExp(`new\\s+${targetClassFullName}\\s*\\(`);
        const match = line.match(newPattern);
        if (match) {
            const startPos = match.index!;
            const edit = new vscode.WorkspaceEdit();

            const builderClassName = `${targetClassNameOnly}Builder`;
            const builderClassFullName = `${mainClass.packageName}.jfxbuilder.${builderClassName}`;
            // Check existing import statements
            const documentText = editor.document.getText();
            const importPattern = new RegExp(`^import\\s+${builderClassFullName};`, 'm');

            if (!importPattern.test(documentText)) {
                // Find package statement
                const packageMatch = documentText.match(/^package\s+[^;]+;/m);

                if (packageMatch) {
                    const packageEndPos = editor.document.positionAt(packageMatch.index! + packageMatch[0].length);
                    // Add import statement after package statement
                    edit.insert(editor.document.uri, new vscode.Position(packageEndPos.line + 1, 0),
                        `\nimport ${builderClassFullName};\n`);
                }
            }

            // Replace 'new TargetClassName' with 'new TargetClassNameBuilder'
            const range = new vscode.Range(
                cursorPosition.line,
                startPos + 4,
                cursorPosition.line,
                startPos + 4 + targetClassFullName.length
            );
            var indent = ' '.repeat(startPos + 8);
            edit.replace(editor.document.uri, range, `${builderClassName}()\n${indent}.build`);
            await vscode.workspace.applyEdit(edit);
        }

        await createBuilderClassFile(methodInfoList, mainClass, targetClassNameOnly);
    } else {
        console.log('Main class not found.');
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

async function createBuilderClassFile(methodInfoList: MethodInfo[], mainClass: { packageName: string, filePath: string }, targetClassName: string) {
    const mainClassPath = mainClass.filePath;
    const mainClassDir = mainClassPath.substring(0, mainClassPath.lastIndexOf(path.sep));

    // Create jfxbuilder folder path
    const builderDirPath = `${mainClassDir}/jfxbuilder`;
    const builderFilePath = `${builderDirPath}/${targetClassName}Builder.java`;

    try {
        // Generate Builder methods
        const builderMethods = methodInfoList
            .map(info => {
                const methodName = info.methodName.substring(3); // Remove 'set'
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

                // Add generic type parameter if <T> is in parameter list
                const hasGenericType = paramList.includes('<T>');
                const methodSignature = hasGenericType ?
                    `    public <T extends Event> ${targetClassName}Builder ${builderMethodName}(${paramList})` :
                    `    public ${targetClassName}Builder ${builderMethodName}(${paramList})`;
                return methodSignature + ` { in.${info.methodName}(${paramNames}); return this; }`;
            })
            .join('\n\n');

        // Generate Builder class code
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

        // Create folder if it doesn't exist
        if (!fs.existsSync(builderDirPath)) {
            fs.mkdirSync(builderDirPath);
        }

        // Create file
        fs.writeFileSync(builderFilePath, builderCode);
        console.log(`Builder class created: ${builderFilePath}`);

        // Run diagnostics every 0.5 seconds for 20 times
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const diagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(builderFilePath));
            if (diagnostics.length > 0) {
                // Comment out lines with diagnostics
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
        console.error('Failed to create Builder class:', error);
    }
} 