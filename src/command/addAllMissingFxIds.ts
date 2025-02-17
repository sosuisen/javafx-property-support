import * as vscode from 'vscode';
import { getFxmlByControllerFilePath, findClassDeclarationLine, calculateIndentation } from '../util';
import { fxmlDictionary } from '../fxmlDictionary';

export async function addAllMissingFxIds() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('Editor is not open.');
        return;
    }

    const document = editor.document;
    const fxmlPath = getFxmlByControllerFilePath(document.uri.fsPath);
    if (!fxmlPath) {
        vscode.window.showErrorMessage('Corresponding FXML file not found.');
        return;
    }

    const fxmlData = fxmlDictionary[fxmlPath];
    const javaText = document.getText();

    const edit = new vscode.WorkspaceEdit();
    let classDeclarationLine = findClassDeclarationLine(javaText);
    if (classDeclarationLine === -1) {
        vscode.window.showErrorMessage('Class definition not found.');
        return;
    }

    const indentUnit = calculateIndentation(document, classDeclarationLine + 1, classDeclarationLine + 4);
    const insertPosition = new vscode.Position(classDeclarationLine + 1, 0);

    const missingFields = fxmlData.tagAndFxIds
        .filter(pair => !hasFxIdField(javaText, pair.fxId))
        .map(pair => `${indentUnit}@FXML\n${indentUnit}private ${pair.tagName} ${pair.fxId};\n\n`)
        .join('');

    if (missingFields) {
        edit.insert(document.uri, insertPosition, missingFields);
        await vscode.workspace.applyEdit(edit);
    }
}

function hasFxIdField(javaText: string, fxId: string): boolean {
    const pattern = new RegExp(`@FXML\\s+\\S+\\s+\\S+\\s+${fxId}\\s*;`);
    return pattern.test(javaText);
} 