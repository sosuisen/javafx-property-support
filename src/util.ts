import * as vscode from 'vscode';

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


    const tabSize = editorConfig.get<number>('tabSize', 4);

    const lines = document.getText().split('\n').slice(startLine, endLine);
    const indents = lines
        .map(line => line.match(/^[ \t]*/)?.[0].length || 0)
        .filter(indent => indent > 0);

    const spaceCount = lines.filter(line => line.startsWith(' ')).length;
    const tabCount = lines.filter(line => line.startsWith('\t')).length;
    const useSpaces = spaceCount > tabCount;
    //    const useSpaces = editorConfig.get<boolean>('insertSpaces', true);   

    const defaultIndent = useSpaces ? ' '.repeat(tabSize) : '\t';

    const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
    const unit = useSpaces ? ' ' : '\t';
    return minIndent > 0 ? unit.repeat(minIndent) : defaultIndent;
}
