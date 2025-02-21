import * as vscode from 'vscode';
import { findMainClass } from '../util';
import * as path from 'path';
import * as fs from 'fs';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('scene-class-diagnostic');

export async function diagSceneClass(document: vscode.TextDocument) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
        return;
    }
    diagnosticCollection.delete(document.uri);
    const diagnostics: vscode.Diagnostic[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;

        const constructorPattern = /new\s+([\w.]+)\s*\(/;
        const match = line.match(constructorPattern);

        if (match) {
            // MyClass or my.package.MyClass
            const targetClassFullName = match[1];
            const classNamePattern = /new\s+[\w.]+?\.(\w+?)\s*\(/;
            const classMatch = line.match(classNamePattern);
            // MyClass
            const targetClassNameOnly = classMatch ? classMatch[1] : targetClassFullName;
            const classStartAt = line.indexOf(targetClassNameOnly + "(");
            const classPosition = new vscode.Position(i, classStartAt + 1);

            // Get type definitions
            try {
                const typeDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeTypeDefinitionProvider',
                    document.uri,
                    classPosition
                );

                // Show CodeLens only if new of javafx.scene.* Class is found
                if (!typeDefinitions || typeDefinitions.length === 0 ||
                    !typeDefinitions[0].uri.path.includes('javafx.scene')
                ) {
                    continue;
                }

                const mainClass = await findMainClass(document.uri);
                if (!mainClass) {
                    continue;
                }
                const mainClassPath = mainClass.filePath;
                const mainClassDir = mainClassPath.substring(0, mainClassPath.lastIndexOf(path.sep));
                const builderDirPath = `${mainClassDir}/jfxbuilder`;
                const builderFilePath = `${builderDirPath}/${targetClassNameOnly}Builder.java`;
                if (fs.existsSync(builderFilePath)) {
                    continue;
                }

                const range = new vscode.Range(
                    i,
                    classStartAt,
                    i,
                    classStartAt + targetClassNameOnly.length
                );



                const message = 'Can generate builder class';
                const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Hint);
                diagnostics.push(diagnostic);

            } catch (e) {
                console.error(e);
            }
        }
        diagnosticCollection.set(document.uri, diagnostics);
    }
}
