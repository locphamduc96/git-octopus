/** Dark theme values for the `--vscode-*` variables the webview reads (the screenshot harness set). */
export const SPIKE_THEME_CSS = `:root {
	--vscode-editor-background: #1e1e1e;
	--vscode-foreground: #cccccc;
	--vscode-descriptionForeground: #9d9d9d;
	--vscode-panel-border: #2b2b2b;
	--vscode-textLink-foreground: #3794ff;
	--vscode-font-family: -apple-system, 'Helvetica Neue', sans-serif;
	--vscode-font-size: 13px;
	--vscode-editor-font-family: 'SF Mono', Menlo, Monaco, monospace;
	--vscode-editor-font-size: 12px;
	--vscode-badge-background: #4d4d4d;
	--vscode-badge-foreground: #ffffff;
	--vscode-button-background: #0e639c;
	--vscode-button-foreground: #ffffff;
	--vscode-button-hoverBackground: #1177bb;
	--vscode-button-secondaryBackground: #3a3d41;
	--vscode-button-secondaryForeground: #ffffff;
	--vscode-checkbox-background: #3c3c3c;
	--vscode-checkbox-border: #6b6b6b;
	--vscode-dropdown-background: #3c3c3c;
	--vscode-dropdown-border: #3c3c3c;
	--vscode-dropdown-foreground: #f0f0f0;
	--vscode-editorHoverWidget-background: #252526;
	--vscode-editorHoverWidget-border: #454545;
	--vscode-editorHoverWidget-foreground: #cccccc;
	--vscode-editorLineNumber-foreground: #858585;
	--vscode-editorOverviewRuler-addedForeground: rgba(129, 184, 139, 0.6);
	--vscode-editorOverviewRuler-deletedForeground: rgba(201, 97, 97, 0.6);
	--vscode-editorWarning-foreground: #cca700;
	--vscode-editorWidget-background: #252526;
	--vscode-editorWidget-border: #454545;
	--vscode-errorForeground: #f48771;
	--vscode-focusBorder: #007fd4;
	--vscode-diffEditor-insertedTextBackground: rgba(156, 204, 44, 0.15);
	--vscode-diffEditor-removedTextBackground: rgba(255, 0, 0, 0.15);
	--vscode-diffEditor-diagonalFill: rgba(204, 204, 204, 0.2);
	--vscode-gitDecoration-addedResourceForeground: #81b88b;
	--vscode-gitDecoration-conflictingResourceForeground: #e4676b;
	--vscode-gitDecoration-deletedResourceForeground: #c74e39;
	--vscode-gitDecoration-modifiedResourceForeground: #e2c08d;
	--vscode-gitDecoration-untrackedResourceForeground: #73c991;
	--vscode-input-background: #3c3c3c;
	--vscode-input-border: #3c3c3c;
	--vscode-input-foreground: #cccccc;
	--vscode-input-placeholderForeground: #a6a6a6;
	--vscode-inputValidation-errorBorder: #be1100;
	--vscode-list-activeSelectionBackground: #04395e;
	--vscode-list-activeSelectionForeground: #ffffff;
	--vscode-list-dropBackground: #062f4a;
	--vscode-list-hoverBackground: #2a2d2e;
	--vscode-menu-background: #252526;
	--vscode-menu-border: #454545;
	--vscode-menu-foreground: #cccccc;
	--vscode-menu-selectionBackground: #04395e;
	--vscode-menu-selectionForeground: #ffffff;
	--vscode-progressBar-background: #0e70c0;
	--vscode-sideBar-background: #1e1e1e;
	--vscode-textBlockQuote-background: #2b2b2b;
	--vscode-toolbar-hoverBackground: rgba(90, 93, 94, 0.31);
}
html, body { height: 100%; margin: 0; }
body {
	background: var(--vscode-editor-background);
	color: var(--vscode-foreground);
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
}
#app { height: 100%; }`;
