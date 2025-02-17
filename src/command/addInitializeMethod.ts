import * as vscode from 'vscode';
import { calculateIndentation, findClassDeclarationLine, findClassEndLine, getFxmlByControllerFilePath } from '../util';

export async function addInitializeMethod(document: vscode.TextDocument, classEndLine: number) {
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
${indentUnit}${indentUnit}// Hint: initialize() will be called when the associated FXML has been completely loaded.
${indentUnit}}
`;
    edit.insert(document.uri, insertPosition, initializeMethod);
    vscode.workspace.applyEdit(edit);
} 