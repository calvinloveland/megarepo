const vscode = require('vscode');

let operationalize_status_bar_item;
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

    let disposable = vscode.commands.registerCommand('operationalize-code-ext.optTest', () => {
        vscode.window.showInformationMessage('Hello World!');
    });

    context.subscriptions.push(disposable);

	console.log('Congratulations, your extension "operationalize" is now active!');
	operationalize_status_bar_item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	context.subscriptions.push(operationalize_status_bar_item);
	// Update the status bar every second
	setInterval(update_status_bar_item, 1000);

}

// This method is called when your extension is deactivated
function deactivate() {}

function update_status_bar_item() {
	let prepend = "$(gear)OPR: "		
	var output_text = prepend
	// Read TODO file and update status bar item
	vscode.workspace.findFiles('**/TODO.txt').then((uris) => {
		if (uris.length > 0) {
			let uri = uris[0];
			vscode.workspace.openTextDocument(uri).then((doc) => {
				let text = doc.getText();
				let lines = text.split('\n');
				// Find the first line that matches the TODO pattern
				// (AA) Something to do
				let todo_line = lines.find((line) => {
					return line.match(/^\([A-Z]+\)/);
				});
				if (todo_line) {
					// Remove the TODO pattern from the line
					let todo_text = todo_line.replace(/^\([A-Z]+\)/, '');
					// Remove the trailing key-value pairs
					todo_text = todo_text.replace(/\s+\w+:\w+$/, '');
					// Remove the trailing whitespace
					todo_text = todo_text.trim();
					// Remove the leading whitespace
					todo_text = todo_text.replace(/^\s+/, '');
					output_text += todo_text;
				} 
			}
		)} 
	}
	)
	if (output_text == prepend) {
				output_text += "See the webUI";
	}
	operationalize_status_bar_item.text = output_text;
	operationalize_status_bar_item.show();
}

module.exports = {
	activate,
	deactivate
}
