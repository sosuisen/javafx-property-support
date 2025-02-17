import * as vscode from 'vscode';
import * as fs from 'fs';
import { getFxmlByControllerFilePath, findClassDeclarationLine, hasFxIdField } from '../util';
import { fxmlDictionary } from '../fxmlDictionary';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('fxid-diagnostic');

async function createDocumentFromText(
    content: string,
    language: string = 'plaintext'
): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument({
        content: content,
        language: language
    });
    return document;
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

export async function processJavaFileByPath(fullPath: string) {
    const fxmlPath = getFxmlByControllerFilePath(fullPath);
    if (!fxmlPath) { return; }

    const javaText = fs.readFileSync(fullPath, 'utf-8');
    const document = await createDocumentFromText(javaText, 'java');

    processJavaDocument(fxmlPath, document);
}

export async function processJavaFileByTextDocument(document: vscode.TextDocument) {
    const fxmlPath = getFxmlByControllerFilePath(document.uri.fsPath);
    if (!fxmlPath) { return; }

    processJavaDocument(fxmlPath, document);
}