import * as vscode from 'vscode';
import { fxmlDictionary } from './extension';

export function getFxmlByControllerFilePath(controllerFilePath: string): string | undefined {
    return Object.entries(fxmlDictionary)
        .find(([, data]) => data.controllerFilePath === controllerFilePath)?.[0];
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

export function findClassDeclarationLine(text: string): number {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('class')) {
            return i;
        }
    }
    return -1;
}

export function calculateIndentation(document: vscode.TextDocument, startLine: number, endLine: number): string {
    let minIndent = Infinity;
    for (let i = startLine; i <= endLine; i++) {
        if (i >= document.lineCount) break;
        const line = document.lineAt(i);
        if (line.isEmptyOrWhitespace) continue;
        const indent = line.firstNonWhitespaceCharacterIndex;
        if (indent < minIndent) {
            minIndent = indent;
        }
    }
    return ' '.repeat(minIndent);
} 