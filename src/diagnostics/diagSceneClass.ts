import * as vscode from 'vscode';
import { getDeclarationElement } from '../command/declarationElement';
const diagnosticCollection = vscode.languages.createDiagnosticCollection('javafx-property-diagnostic');

export async function diagPropertyClass(document: vscode.TextDocument) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
        return;
    }
    diagnosticCollection.delete(document.uri);
    const diagnostics: vscode.Diagnostic[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;

        const propertyPattern = /\s*([\w.]+Property(?:<[\w,<> ]*>)?)\s+(\w+)\s*=\s*new\s+([\w.]+(?:<[\w,<> ]*>)?)\s*\(/;        // const constructorPattern = /^\s*(\w+)\s+([\w.<,>]+)\s*?=\s*?new\s+([\w.]+Property(<[\w,]*>)?)\s*\(/;
        let match = line.match(propertyPattern);

        if (!match) {
            const wrapperPattern = /\s*(ReadOnly[\w.]+Wrapper(?:<[\w,<> ]*>)?)\s+(\w+)\s*=\s*new\s+([\w.]+(?:<[\w,<> ]*>)?)\s*\(/;        // const constructorPattern = /^\s*(\w+)\s+([\w.<,>]+)\s*?=\s*?new\s+([\w.]+Property(<[\w,]*>)?)\s*\(/;
            match = line.match(wrapperPattern);
        }

        if (!match) {
            continue;
        }
        const propertyFieldTypeName = match[1];
        const propertyFieldName = match[2];
        const propertyClassName = match[3];

        if (propertyFieldName !== "") {
            // Check if getter is already generated
            const { propertyType, getterSetterTypeName, pojoFieldName, pojoFieldNameCapitalized } = getDeclarationElement(propertyFieldTypeName, propertyFieldName, propertyClassName);
            let propertyGetterLine = "";
            if (propertyType === "readOnlyBasicWrapper" || propertyType === "readOnlyObjectWrapper") {
                propertyGetterLine = `public ${propertyFieldTypeName.replace("Wrapper", "Property")} ${pojoFieldName}Property`;
            }
            else {
                propertyGetterLine = `public ${propertyFieldTypeName} ${pojoFieldName}Property`;
            }
            if (document.getText().includes(propertyGetterLine)) {
                continue;
            }

            const classStartAt = line.indexOf(propertyFieldName);
            // Get type definitions
            const range = new vscode.Range(
                i,
                classStartAt,
                i,
                classStartAt + propertyFieldName.length,
            );

            const message = 'Can generate getter and setter';
            const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Hint);
            diagnostics.push(diagnostic);
        }
        diagnosticCollection.set(document.uri, diagnostics);
    }
}
