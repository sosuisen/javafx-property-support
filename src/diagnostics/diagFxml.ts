import * as vscode from 'vscode';
import * as fs from 'fs';
import { fxmlDictionary } from '../fxmlDictionary';
import { TagAndFxId } from '../type';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('fxcontroller-diagnostic');

export function deleteFxmlDiagnostic(fullPath: string) {
    diagnosticCollection.delete(vscode.Uri.file(fullPath));
}

function getControllerFilePath(
    controllerClassName: string,
    workspaceRoot: vscode.Uri
): string {
    // com.example.FooController → com/example/FooController.java
    const parts = controllerClassName.split('.');
    const fileName = parts.pop() + '.java';
    const dirPath = parts.join('/');

    // /path_to_workspace/src/main/java/com/example/FooController.java
    const fullUrl = vscode.Uri.joinPath(workspaceRoot, 'src', 'main', 'java', dirPath, fileName);
    return fullUrl.fsPath;
}

export function processFxmlFile(fullPath: string) {
    try {
        const fxmlContent = fs.readFileSync(fullPath, 'utf-8');
        let workspaceFolder: vscode.WorkspaceFolder | undefined;
        if (fxmlDictionary[fullPath]) {
            workspaceFolder = fxmlDictionary[fullPath].workspaceFolder;
        }
        else {
            workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fullPath));
        }
        if (!workspaceFolder) {
            console.error(`No workspace folder found for ${fullPath}`);
            return;
        }

        const controllerRegex = /fx:controller\s*=\s*"([^"]+)"/;
        const controllerMatch = controllerRegex.exec(fxmlContent);
        const controllerClassName = controllerMatch ? controllerMatch[1] : null;
        let controllerFilePath: string | null = null;
        if (controllerClassName) {
            controllerFilePath = getControllerFilePath(controllerClassName, workspaceFolder.uri);
        }
        else {
            controllerFilePath = null;
            //            console.error(`No fx:controller for ${fullPath}`);
        }

        const fxIdRegex = /<(\w+)[^>]*fx:id\s*=\s*"([^"]+)"/g;

        const tagAndFxIds: Array<TagAndFxId> = [];

        let match;
        // g flag is used to find all matches
        while ((match = fxIdRegex.exec(fxmlContent)) !== null) {
            const tagName = match[1];
            const fxId = match[2];
            tagAndFxIds.push({ tagName, fxId });
        }

        fxmlDictionary[fullPath] = {
            workspaceFolder,
            fullPath,
            controllerFilePath,
            controllerClassName,
            tagAndFxIds,
        };

        const diagnostics: vscode.Diagnostic[] = [];
        let message = "";
        diagnosticCollection.delete(vscode.Uri.file(fullPath));
        if (controllerFilePath === null) {
            message = `Missing fx:controller`;
        }
        else if (!fs.existsSync(controllerFilePath)) {
            message = `Missing ${controllerFilePath}`;
        }
        if (message !== "") {
            const range = new vscode.Range(0, 0, 0, 0);
            const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
            diagnostics.push(diagnostic);
            diagnosticCollection.set(vscode.Uri.file(fullPath), diagnostics);
        }
    } catch (error) {
        console.error(`Error parsing FXML file ${fullPath}:`, error);
    }
}

