import * as vscode from 'vscode';

export class BuilderClassCodeActionProvider implements vscode.CodeActionProvider {
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        return context.diagnostics
            .filter(diagnostic => diagnostic.message.startsWith('Can generate builder class'))
            .map(diagnostic => this.createFix(document, diagnostic));

    }

    private createFix(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const fix = new vscode.CodeAction('Generate Builder Class', vscode.CodeActionKind.QuickFix);
        fix.command = {
            command: 'javafx-builder-class-generator.generateBuilderClass',
            title: 'Generate Builder Class',
            arguments: [document, diagnostic.range]
        };
        return fix;
    }

    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
}
