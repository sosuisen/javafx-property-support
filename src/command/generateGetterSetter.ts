import * as vscode from 'vscode';
import { findClassDeclarationLine, findClassEndLine, calculateIndentation } from '../util';
import { getDeclarationElement } from './declarationElement';
export async function generateGetterSetter(document: vscode.TextDocument, range: vscode.Range) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found.');
        return;
    }

    if (editor.document.languageId !== 'java') {
        vscode.window.showErrorMessage('Not a Java file.');
        return;
    }

    let cursorLine = range.start.line;
    if (document === undefined) {
        document = editor.document;
        const cursorPosition = editor.selection.active;
        cursorLine = cursorPosition.line;
    }
    const classEndLine = findClassEndLine(document.getText());

    const line = editor.document.lineAt(cursorLine).text;

    const propertyPattern = /\s*([\w.]+Property(?:<[\w,<> ]*>)?)\s+(\w+)\s*=\s*new\s+([\w.]+(?:<[\w,<> ]*>)?)\s*\(/;        // const constructorPattern = /^\s*(\w+)\s+([\w.<,>]+)\s*?=\s*?new\s+([\w.]+Property(<[\w,]*>)?)\s*\(/;
    let match = line.match(propertyPattern);

    if (!match) {
        const wrapperPattern = /\s*(ReadOnly[\w.]+Wrapper(?:<[\w,<> ]*>)?)\s+(\w+)\s*=\s*new\s+([\w.]+(?:<[\w,<> ]*>)?)\s*\(/;        // const constructorPattern = /^\s*(\w+)\s+([\w.<,>]+)\s*?=\s*?new\s+([\w.]+Property(<[\w,]*>)?)\s*\(/;
        match = line.match(wrapperPattern);
    }

    if (!match) {
        return;
    }
    const propertyFieldTypeName = match[1];
    const propertyFieldName = match[2];
    const propertyClassName = match[3];

    const { propertyType, getterSetterTypeName, pojoFieldName, pojoFieldNameCapitalized } = getDeclarationElement(propertyFieldTypeName, propertyFieldName, propertyClassName);

    const edit = new vscode.WorkspaceEdit();
    const classDeclarationLine = findClassDeclarationLine(document.getText());
    const indentUnit = calculateIndentation(document, classDeclarationLine + 1, classDeclarationLine + 4);

    const insertPosition = new vscode.Position(classEndLine, 0);

    let initializeMethod = "";

    if (propertyType === "readOnlyBasicWrapper" || propertyType === "readOnlyObjectWrapper") {
        initializeMethod = `
${indentUnit}// ${pojoFieldName}
${indentUnit}public ${propertyFieldTypeName.replace("Wrapper", "Property")} ${pojoFieldName}Property() {
${indentUnit}${indentUnit}return ${propertyFieldName}.getReadOnlyProperty();
${indentUnit}}
`;
    }
    else {
        initializeMethod = `
${indentUnit}// ${pojoFieldName}
${indentUnit}public ${propertyFieldTypeName} ${pojoFieldName}Property() {
${indentUnit}${indentUnit}return ${propertyFieldName};
${indentUnit}}
`;
    }

    initializeMethod += `
${indentUnit}public ${getterSetterTypeName} ${getterSetterTypeName === "boolean" ? "is" : "get"}${pojoFieldNameCapitalized} () {
${indentUnit}${indentUnit} return ${propertyFieldName}.get();
${indentUnit}}
`;


    if (propertyType === "basicProperty" || propertyType === "objectProperty") {
        initializeMethod += `
${indentUnit}public void set${pojoFieldNameCapitalized} (${getterSetterTypeName} ${pojoFieldName}) {
${indentUnit}${indentUnit} this.${propertyFieldName}.set(${pojoFieldName});
${indentUnit}}
`;
    }
    edit.insert(document.uri, insertPosition, initializeMethod);
    vscode.workspace.applyEdit(edit);
}
