import * as vscode from 'vscode';

export class BuilderClassCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        // カーソル位置が変更されたときにCodeLensを更新
        vscode.window.onDidChangeTextEditorSelection(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== document) {
            return [];
        }


        const cursorPosition = editor.selection.active;
        const cursorLine = editor.selection.active.line;
        // カーソル行の内容
        const cursorLineText = document.lineAt(cursorLine).text;
        if (!cursorLineText.includes(' new ')) {
            return [];
        }

        // カーソル位置の前後の文字を取得
        const textBeforeCursor = document.getText(new vscode.Range(
            cursorPosition.line,
            Math.max(0, cursorPosition.character - 1),
            cursorPosition.line,
            cursorPosition.character
        ));
        const textAfterCursor = document.getText(new vscode.Range(
            cursorPosition.line,
            cursorPosition.character,
            cursorPosition.line,
            cursorPosition.character + 1
        ));

        // アルファベットまたは数字かどうかを判定する正規表現
        const alphaNumericPattern = /[a-zA-Z0-9]/;

        // カーソル位置の前後のいずれかの文字がアルファベットまたは数字であるかを判定
        if (!alphaNumericPattern.test(textBeforeCursor) && !alphaNumericPattern.test(textAfterCursor)) {
            return [];
        }

        // 上記のチェック後でないと、vscode.executeTypeDefinitionProviderでワーニングが出る。

        // カーソル位置の型定義を取得
        const typeDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeTypeDefinitionProvider',
            document.uri,
            cursorPosition
        );

        // javafx.scene.* のクラスのnewが見つかった場合のみCodeLensを表示
        if (typeDefinitions && typeDefinitions.length > 0
            && typeDefinitions[0].uri.path.includes('javafx.scene.')
        ) {
            const range = new vscode.Range(
                cursorLine,
                0,
                cursorLine,
                0
            );

            return [new vscode.CodeLens(range, {
                title: 'Generate Builder Class',
                command: 'javafx-controller-support.generateBuilderClass'
            })];
        }

        return [];

    }
}