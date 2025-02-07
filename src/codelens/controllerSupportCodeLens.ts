import * as vscode from 'vscode';
import { getFxmlByControllerFilePath, findClassDeclarationLine, findClassEndLine, hasFxIdField } from '../util';
import { TagAndFxId } from '../type';
import { fxmlDictionary } from '../fxmlDictionary';

function findMissingTagAndFxIds(javaText: string, fxmlPath: string): TagAndFxId[] {
    const missings: TagAndFxId[] = [];
    const fxmlData = fxmlDictionary[fxmlPath];
    if (fxmlData) {

        fxmlData.tagAndFxIds.forEach(pair => {
            if (!hasFxIdField(javaText, pair.fxId)) {
                missings.push(pair);
            }
        });
    }
    return missings;
}

export class ControllerSupportLensProvider implements vscode.CodeLensProvider {


    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const javaText = document.getText();

        const fxmlPath = getFxmlByControllerFilePath(document.uri.fsPath);
        if (fxmlPath) {
            const missingTagAndFxIds = findMissingTagAndFxIds(javaText, fxmlPath);

            if (missingTagAndFxIds.length > 0) {
                const classDeclarationLine = findClassDeclarationLine(javaText);
                if (classDeclarationLine !== -1) {
                    const range = new vscode.Range(classDeclarationLine + 1, 0, classDeclarationLine + 1, 0);
                    const command: vscode.Command = {
                        title: `Add all missing @FXML fields (${missingTagAndFxIds.length})`,
                        command: 'javafx-controller-support.addAllMissingFxIds',
                        arguments: [document, missingTagAndFxIds]
                    };
                    lenses.push(new vscode.CodeLens(range, command));
                }
            }

            if (!this.hasInitializeMethod(javaText)) {
                const classEndLine = findClassEndLine(javaText);
                if (classEndLine !== -1) {
                    const range = new vscode.Range(classEndLine, 0, classEndLine, 0);
                    const command: vscode.Command = {
                        title: "Add public void initialize() method",
                        command: 'javafx-controller-support.addInitializeMethod',
                        arguments: [document, classEndLine]
                    };
                    lenses.push(new vscode.CodeLens(range, command));
                }
            }
        }

        return lenses;
    }

    private hasInitializeMethod(javaText: string): boolean {
        const initializePattern = /public\s+void\s+initialize\s*\(/;
        return initializePattern.test(javaText);
    }
}