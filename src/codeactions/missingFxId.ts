import * as vscode from 'vscode';
import { fxmlDictionary } from '../fxmlDictionary';
import { calculateIndentation, getFxmlByControllerFilePath } from '../util';
import { FxmlData } from '../type';

function getTagNameFromFxId(fxmlData: FxmlData, fxId: string): string {
    const tagAndFxId = fxmlData.tagAndFxIds.find(pair => pair.fxId === fxId);
    if (tagAndFxId) {
        return tagAndFxId.tagName;
    }
    return "Node";
}

function insertFieldWithIndent(
    document: vscode.TextDocument,
    edit: vscode.WorkspaceEdit,
    insertLine: number,
    tagName: string,
    fxId: string

) {
    const indentUnit = calculateIndentation(document, insertLine, insertLine + 3);
    const insertPosition = new vscode.Position(insertLine, 0);
    const fieldDeclaration = `${indentUnit}@FXML\n${indentUnit}private ${tagName} ${fxId};\n\n`;
    edit.insert(document.uri, insertPosition, fieldDeclaration);
}

export class MissingFxIdProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];


    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] | undefined {
        return context.diagnostics
            .filter(diagnostic => diagnostic.message.startsWith('Missing @FXML field for fx:id='))
            .map(diagnostic => this.createFix(document, diagnostic));
    }

    private createFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const fxIdMatch = diagnostic.message.match(/fx:id="([^"]+)"/);
        const fxId = fxIdMatch ? fxIdMatch[1] : 'unknown';

        const fix = new vscode.CodeAction(`Add @FXML field for ${fxId}`, vscode.CodeActionKind.QuickFix);

        const fxmlPath = getFxmlByControllerFilePath(document.uri.fsPath);
        if (!fxmlPath) {
            console.error(`No corresponding FXML file found for ${document.uri.fsPath}`);
            return fix;
        }
        const fxmlData = fxmlDictionary[fxmlPath];
        const tagName = getTagNameFromFxId(fxmlData, fxId);

        fix.edit = new vscode.WorkspaceEdit();

        insertFieldWithIndent(document, fix.edit, diagnostic.range.start.line, tagName, fxId);

        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        return fix;
    }
}