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

export function findClassDeclarationLine(text: string): number {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('class')) {
            return i;
        }
    }
    return -1;
}

export function findClassEndLine(text: string): number {
    const lines = text.split('\n');
    let braceCount = 0;
    let classStartFound = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!classStartFound && line.includes('class')) {
            classStartFound = true;
        }
        if (classStartFound) {
            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;
            if (braceCount === 0) {
                return i;
            }
        }
    }
    return -1;
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
