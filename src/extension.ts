import * as vscode from 'vscode';
import { BuilderClassCodeLensProvider } from './codelens/builderClassCodeLens';
import { generateBuilderClass } from './command/generateBuilderClass';

// This method is called when the extension is activated
export async function activate(context: vscode.ExtensionContext) {
	console.log('JavaFX Builder Class Generator extension is activated');

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider('java', new BuilderClassCodeLensProvider())
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('javafx-builder-class-generator.generateBuilderClass', generateBuilderClass)
	);

}

// This method is called when your extension is deactivated
export function deactivate() { }