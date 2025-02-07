import * as vscode from 'vscode';

export type TagAndFxId = {
    tagName: string;
    fxId: string;
}

export type FxmlFileInfo = {
    workspaceFolder: vscode.WorkspaceFolder;
    fullPath: string;
}

export type FxmlData = FxmlFileInfo & {
    controllerFilePath: string | null,
    controllerClassName: string | null,
    tagAndFxIds: Array<TagAndFxId>
}

