import * as vscode from 'vscode';
import { BuilderClassCodeLensProvider } from './codelens/builderClassCodeLens';
import { generateBuilderClass } from './command/generateBuilderClass';
import path from 'path';
import { checkModule, deleteModule } from './util';

// This method is called when the extension is activated
export async function activate(context: vscode.ExtensionContext) {
	console.log('JavaFX Builder Class Generator extension is activated');

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		console.error('No workspace folder is open.');
		return;
	}

	async function checkAllJavaFiles() {
		const files = await vscode.workspace.findFiles("**/module-info.java");
		files.forEach(async uri => {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
			checkModule(document);
		});
	}


	/**
	 * Observe changes of *.java files.
	 */
	checkAllJavaFiles();
	const javaWatcher = vscode.workspace.createFileSystemWatcher('**/*.java');
	// Change of *.java file is detected when the file is saved.
	javaWatcher.onDidChange(async uri => {
		if (uri.path.endsWith('module-info.java')) {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
			checkModule(document);
		}
	});
	javaWatcher.onDidCreate(async uri => {
		if (uri.path.endsWith('module-info.java')) {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
			checkModule(document);
		}
	});
	javaWatcher.onDidDelete(async uri => {
		if (uri.path.endsWith('module-info.java')) {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
			deleteModule(document);
		}
	});

	// A change to the .java file is detected if it is not saved.	
	vscode.workspace.onDidChangeTextDocument(event => {
		const document = event.document;
		if (document.fileName === 'module-info.java') {
			checkModule(document);
		}
	});


	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('java', new BuilderClassCodeLensProvider())
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('javafx-builder-class-generator.generateBuilderClass', generateBuilderClass)
	);

}

// This method is called when your extension is deactivated
export function deactivate() { }