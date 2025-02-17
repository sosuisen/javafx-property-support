import * as vscode from 'vscode';
import { generateBuilderClass } from './command/generateBuilderClass';
import { addInitializeMethod } from './command/addInitializeMethod';
import { addAllMissingFxIds } from './command/addAllMissingFxIds';
import { getFxmlByControllerFilePath } from './util';
import { BuilderClassCodeLensProvider } from './codelens/builderClassCodeLens';
import { fxmlDictionary } from './fxmlDictionary';
import { ControllerSupportLensProvider } from './codelens/controllerSupportCodeLens';
import { MissingFxIdProvider } from './codeactions/missingFxId';
import { deleteJavaDiagnostic, processJavaDocument } from './diagnostics/diagJava';
import { deleteFxmlDiagnostic, processFxmlFile } from './diagnostics/diagFxml';
import path from 'path';

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
				processJavaDocument(document);
			}
		});
	}
	// Check all *.fxml files.
	await checkAllFxmlFiles();
	const fxmlWatcher = vscode.workspace.createFileSystemWatcher('**/*.fxml');
	// Change of *.fxml file is detected when the file is saved.
	fxmlWatcher.onDidChange(uri => {
		// *.fxml files may be in the bin directory. Skip them.
		if (!uri.fsPath.includes('src' + path.sep)) {
			return;
		}
		processFxmlFile(uri.fsPath);
		checkAllOpenedJavaFiles();
	});
	fxmlWatcher.onDidCreate(uri => {
		if (!uri.fsPath.includes('src' + path.sep)) {
			return;
		}
		processFxmlFile(uri.fsPath);
		checkAllOpenedJavaFiles();
	});
	fxmlWatcher.onDidDelete(uri => {
		if (!uri.fsPath.includes('src' + path.sep)) {
			return;
		}
		deleteJavaDiagnostic(fxmlDictionary[uri.fsPath].controllerFilePath);
		deleteFxmlDiagnostic(uri.fsPath);
		delete fxmlDictionary[uri.fsPath];
		checkAllOpenedJavaFiles();
	});

	/**
	 * Observe changes of *.java files.
	 */
	checkAllOpenedJavaFiles();
	const javaWatcher = vscode.workspace.createFileSystemWatcher('**/*.java');
	// Change of *.java file is detected when the file is saved.
	javaWatcher.onDidChange(async uri => {
		if (!uri.fsPath.includes('src' + path.sep)) {
			return;
		}
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
		processJavaDocument(document);
	});
	javaWatcher.onDidCreate(async uri => {
		if (!uri.fsPath.includes('src' + path.sep)) {
			return;
		}
		console.log('create java file', uri.fsPath);
		await checkAllFxmlFiles(); // check fx:controller
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(uri.fsPath));
		processJavaDocument(document);
	});
	javaWatcher.onDidDelete(uri => {
		if (!uri.fsPath.includes('src' + path.sep)) {
			return;
		}
		deleteJavaDiagnostic(uri.fsPath);
		const fxmlPath = getFxmlByControllerFilePath(uri.fsPath);
		if (fxmlPath) {
			processFxmlFile(fxmlPath); // check fx:controller
			fxmlDictionary[fxmlPath].controllerFilePath = null;
			fxmlDictionary[fxmlPath].controllerClassName = null;
		}
	});

	// A change to the .java file is detected if it is not saved.	
	vscode.workspace.onDidChangeTextDocument(event => {
		const document = event.document;
		if (document.languageId === 'java') {
			processJavaDocument(document);
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