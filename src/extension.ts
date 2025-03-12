import * as vscode from 'vscode';
import { generateGetterSetter } from './command/generateGetterSetter';
import { GenerateGetterSetterCodeActionProvider } from './codeactions/GenerateGetterSetter';
import { diagPropertyClass } from './diagnostics/diagSceneClass';

// This method is called when the extension is activated
export async function activate(context: vscode.ExtensionContext) {
	console.log('JavaFX Property Support extension is activated');

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		console.error('No workspace folder is open.');
		return;
	}

	async function checkAllJavaFiles() {
		const files = await vscode.workspace.findFiles("**/*.java");
		files.forEach(async uri => {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
			diagPropertyClass(document);
		});
	}

	/**
	 * Observe changes of *.java files.
	 */
	checkAllJavaFiles();
	const javaWatcher = vscode.workspace.createFileSystemWatcher('**/*.java');
	// Change of *.java file is detected when the file is saved.
	javaWatcher.onDidChange(async uri => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
		diagPropertyClass(document);
	});
	javaWatcher.onDidCreate(async uri => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
		diagPropertyClass(document);
	});
	javaWatcher.onDidDelete(async uri => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
		diagPropertyClass(document);
	});

	// A change to the .java file is detected if it is not saved.	
	vscode.workspace.onDidChangeTextDocument(event => {
		const document = event.document;
		if (document.languageId === 'java') {
			diagPropertyClass(document);
		}
	});

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('java', new GenerateGetterSetterCodeActionProvider(),
			{ providedCodeActionKinds: GenerateGetterSetterCodeActionProvider.providedCodeActionKinds })
	);


	context.subscriptions.push(
		vscode.commands.registerCommand('javafx-builder-class-generator.generateGetterSetter', (document: vscode.TextDocument, range: vscode.Range) =>
			generateGetterSetter(document, range)
		)
	);

}

// This method is called when your extension is deactivated
export function deactivate() { }