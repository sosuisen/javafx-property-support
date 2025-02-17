import * as vscode from 'vscode';
import { fxmlDictionary } from './fxmlDictionary';

export function hasFxIdField(javaText: string, fxId: string): boolean {
    const pattern = new RegExp(`@FXML\\s+\\S+\\s+\\S+\\s+${fxId}\\s*;`);
    return pattern.test(javaText);
}

export function getFxmlByControllerFilePath(controllerFilePath: string): string | undefined {
    return Object.entries(fxmlDictionary)
        .find(([, data]) => data.controllerFilePath === controllerFilePath)?.[0];
}

function searchClassDeclaration(text: string, func: (i: number, startBraceCount: number, endBraceCount: number, classStartLine: number) => { continue: boolean, result: number }): number {
    const lines = text.split('\n');
    let startBraceCount = 0;
    let endBraceCount = 0;
    let classStartLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const classPattern = /class\s+[A-Z]/;
        if (classPattern.test(line)) {
            classStartLine = i;
        }
        if (classStartLine >= 0) {
            startBraceCount += (line.match(/{/g) || []).length;
            endBraceCount += (line.match(/}/g) || []).length;
            const result = func(i, startBraceCount, endBraceCount, classStartLine);
            if (!result.continue) {
                return result.result;
            }
        }
    }
    return -1;
}

export function findClassDeclarationLine(text: string): number {
    return searchClassDeclaration(text, (i, startBraceCount, endBraceCount, classStartLine) => {
        if (startBraceCount > 0 && startBraceCount - endBraceCount === 0) {
            if (i > classStartLine) {
                return { continue: false, result: classStartLine };
            }
            else {
                // Skip if class body is empty
                return { continue: false, result: -1 };
            }
        }
        return { continue: true, result: -1 };
    });
}

export function findClassEndLine(text: string): number {
    return searchClassDeclaration(text, (i, startBraceCount, endBraceCount, classStartLine) => {
        if (startBraceCount > 0 && startBraceCount - endBraceCount === 0) {
            if (i > classStartLine) {
                return { continue: false, result: i };
            }
            else {
                // Skip if class body is empty
                return { continue: false, result: -1 };
            }
        }
        return { continue: true, result: -1 };
    });
}

export function calculateIndentation(document: vscode.TextDocument, startLine: number, endLine: number): string {
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

export async function findMainClass(uri: vscode.Uri): Promise<{ packageName: string, filePath: string } | null> {
    const currentFileUri = vscode.Uri.parse(uri.toString());
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentFileUri);
    if (!workspaceFolder) {
        return null;
    }
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
