import * as vscode from 'vscode';
import { generateBuilderClass } from './command/generateBuilderClass';
import { addInitializeMethod } from './command/addInitializeMethod';
import { addAllMissingFxIds } from './command/addAllMissingFxIds';
import { getFxmlByControllerFilePath } from './util';
import { BuilderClassCodeLensProvider } from './codelens/builderClassCodeLens';
import { fxmlDictionary } from './fxmlDictionary';
import { ControllerSupportLensProvider } from './codelens/controllerSupportCodeLens';
import { MissingFxIdProvider } from './codeactions/missingFxId';
import { processJavaFileByPath, processJavaFileByTextDocument } from './diagnostics/diagJava';
import { processFxmlFile } from './diagnostics/diagFxml';

// This method is called when the extension is activated
export async function activate(context: vscode.ExtensionContext) {
	console.log('JavaFX Controller Support extension is activated');

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		console.error('No workspace folder is open.');
		return;
	}

	/**
	 * Observe changes of *.fxml files.
	 */
	async function checkAllFxmlFiles() {
		const files = await vscode.workspace.findFiles("src/**/*.fxml");
		files.forEach(uri => {
			processFxmlFile(uri.fsPath);
		});
	}

	function checkAllOpenedJavaFiles() {
		vscode.workspace.textDocuments.forEach(document => {
			if (document.languageId === 'java') {
				processJavaFileByTextDocument(document);
			}
		});
	}
	// Check all *.fxml files.
	await checkAllFxmlFiles();
	// *.fxml files may be in the bin directory. Skip them.
	const fxmlWatcher = vscode.workspace.createFileSystemWatcher('src/**/*.fxml');
	// Change of *.fxml file is detected when the file is saved.
	fxmlWatcher.onDidChange(uri => {
		processFxmlFile(uri.fsPath);
		checkAllOpenedJavaFiles();
	});
	fxmlWatcher.onDidCreate(uri => {
		processFxmlFile(uri.fsPath);
		checkAllOpenedJavaFiles();
	});
	fxmlWatcher.onDidDelete(uri => {
		delete fxmlDictionary[uri.fsPath];
		checkAllOpenedJavaFiles();
	});

	/**
	 * Observe changes of *.java files.
	 */
	checkAllOpenedJavaFiles();
	const javaWatcher = vscode.workspace.createFileSystemWatcher('src/**/*.java');
	// Change of *.java file is detected when the file is saved.
	javaWatcher.onDidChange(uri => processJavaFileByPath(uri.fsPath));
	javaWatcher.onDidCreate(uri => processJavaFileByPath(uri.fsPath));
	javaWatcher.onDidDelete(uri => {
		const fxmlPath = getFxmlByControllerFilePath(uri.fsPath);
		if (fxmlPath) {
			delete fxmlDictionary[fxmlPath];
		}
	});

	// A change to the .java file is detected if it is not saved.	
	vscode.workspace.onDidChangeTextDocument(event => {
		const document = event.document;
		if (document.languageId === 'java') {
			processJavaFileByTextDocument(document);
		}
	});

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('java', new MissingFxIdProvider(), {
			providedCodeActionKinds: MissingFxIdProvider.providedCodeActionKinds
		})
	);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('java', new ControllerSupportLensProvider())
	);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('java', new BuilderClassCodeLensProvider())
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('javafx-controller-support.addAllMissingFxIds', addAllMissingFxIds)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('javafx-controller-support.addInitializeMethod',
			(document: vscode.TextDocument, classEndLine: number) => addInitializeMethod(document, classEndLine))
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('javafx-controller-support.generateBuilderClass', generateBuilderClass)
	);

	context.subscriptions.push(fxmlWatcher);

}

// This method is called when your extension is deactivated
export function deactivate() { }