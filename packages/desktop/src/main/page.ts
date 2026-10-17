import type { ThemeKind } from '../ipc.js';

/**
 * The window's document: the view's bundle, under the same CSP a VS Code webview gets, and the
 * `--vscode-*` theme variables the view reads — which in VS Code the editor injects from its theme.
 */
const MAP_SHARED: Record<string, string> = {
	'font-family': "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
	'font-size': '13px',
	'editor-font-family': "'SF Mono', Menlo, Monaco, monospace",
	'editor-font-size': '12px',
};

const MAP_DARK: Record<string, string> = {
	'editor-background': '#1e1e1e',
	foreground: '#cccccc',
	descriptionForeground: '#9d9d9d',
	'panel-border': '#2b2b2b',
	'textLink-foreground': '#3794ff',
	'badge-background': '#4d4d4d',
	'badge-foreground': '#ffffff',
	'button-background': '#0e639c',
	'button-foreground': '#ffffff',
	'button-hoverBackground': '#1177bb',
	'button-secondaryBackground': '#3a3d41',
	'button-secondaryForeground': '#ffffff',
	'dropdown-background': '#3c3c3c',
	'dropdown-border': '#3c3c3c',
	'dropdown-foreground': '#f0f0f0',
	'editor-findMatchBackground': 'rgba(81, 92, 106, 0.9)',
	'editor-findMatchBorder': '#74879f',
	'editor-findMatchHighlightBackground': 'rgba(234, 92, 0, 0.33)',
	'editor-rangeHighlightBackground': 'rgba(255, 255, 255, 0.04)',
	'editorHoverWidget-background': '#252526',
	'editorHoverWidget-border': '#454545',
	'editorHoverWidget-foreground': '#cccccc',
	'editorLineNumber-foreground': '#858585',
	'editorOverviewRuler-addedForeground': 'rgba(129, 184, 139, 0.6)',
	'editorOverviewRuler-deletedForeground': 'rgba(201, 97, 97, 0.6)',
	'editorWarning-foreground': '#cca700',
	'editorWidget-background': '#252526',
	errorForeground: '#f48771',
	focusBorder: '#007fd4',
	'diffEditor-insertedTextBackground': 'rgba(156, 204, 44, 0.15)',
	'diffEditor-removedTextBackground': 'rgba(255, 0, 0, 0.15)',
	'diffEditor-diagonalFill': 'rgba(204, 204, 204, 0.2)',
	'gitDecoration-addedResourceForeground': '#81b88b',
	'gitDecoration-conflictingResourceForeground': '#e4676b',
	'gitDecoration-deletedResourceForeground': '#c74e39',
	'gitDecoration-modifiedResourceForeground': '#e2c08d',
	'input-background': '#3c3c3c',
	'input-border': '#3c3c3c',
	'input-foreground': '#cccccc',
	'inputOption-activeBackground': 'rgba(0, 127, 212, 0.4)',
	'inputOption-activeBorder': '#007acc',
	'inputOption-activeForeground': '#ffffff',
	'inputValidation-errorBorder': '#be1100',
	'keybindingLabel-background': 'rgba(128, 128, 128, 0.17)',
	'keybindingLabel-foreground': '#cccccc',
	'list-activeSelectionBackground': '#04395e',
	'list-activeSelectionForeground': '#ffffff',
	'list-dropBackground': '#062f4a',
	'list-hoverBackground': '#2a2d2e',
	'menu-background': '#252526',
	'menu-border': '#454545',
	'menu-foreground': '#cccccc',
	'menu-selectionBackground': '#04395e',
	'menu-selectionForeground': '#ffffff',
	'testing-iconPassed': '#73c991',
	'toolbar-hoverBackground': 'rgba(90, 93, 94, 0.31)',
	'toolbar-activeBackground': 'rgba(99, 102, 103, 0.31)',
	'button-secondaryHoverBackground': '#45494e',
	'sideBar-background': '#181818',
	'widget-shadow': 'rgba(0, 0, 0, 0.36)',
	disabledForeground: 'rgba(204, 204, 204, 0.5)',
	'gitDecoration-untrackedResourceForeground': '#73c991',
	'charts-red': '#f14c4c',
	'charts-blue': '#3794ff',
	'charts-yellow': '#cca700',
	'charts-orange': '#d18616',
	'charts-green': '#89d185',
	'charts-purple': '#b180d7',
	'terminal-ansiMagenta': '#bc3fbc',
	'terminal-ansiCyan': '#11a8cd',
	'checkbox-background': '#313131',
	'checkbox-border': '#3c3c3c',
};

const MAP_LIGHT: Record<string, string> = {
	'editor-background': '#ffffff',
	foreground: '#3b3b3b',
	descriptionForeground: '#717171',
	'panel-border': '#e5e5e5',
	'textLink-foreground': '#005fb8',
	'badge-background': '#cccccc',
	'badge-foreground': '#3b3b3b',
	'button-background': '#005fb8',
	'button-foreground': '#ffffff',
	'button-hoverBackground': '#0258a8',
	'button-secondaryBackground': '#e5e5e5',
	'button-secondaryForeground': '#3b3b3b',
	'dropdown-background': '#ffffff',
	'dropdown-border': '#cecece',
	'dropdown-foreground': '#3b3b3b',
	'editor-findMatchBackground': 'rgba(169, 202, 255, 0.8)',
	'editor-findMatchBorder': '#5f8fd8',
	'editor-findMatchHighlightBackground': 'rgba(234, 92, 0, 0.25)',
	'editor-rangeHighlightBackground': 'rgba(0, 0, 0, 0.04)',
	'editorHoverWidget-background': '#f8f8f8',
	'editorHoverWidget-border': '#c8c8c8',
	'editorHoverWidget-foreground': '#3b3b3b',
	'editorLineNumber-foreground': '#6e7681',
	'editorOverviewRuler-addedForeground': 'rgba(72, 152, 92, 0.6)',
	'editorOverviewRuler-deletedForeground': 'rgba(199, 78, 57, 0.6)',
	'editorWarning-foreground': '#bf8803',
	'editorWidget-background': '#f8f8f8',
	errorForeground: '#c4314b',
	focusBorder: '#005fb8',
	'diffEditor-insertedTextBackground': 'rgba(156, 204, 44, 0.25)',
	'diffEditor-removedTextBackground': 'rgba(255, 0, 0, 0.18)',
	'diffEditor-diagonalFill': 'rgba(34, 34, 34, 0.2)',
	'gitDecoration-addedResourceForeground': '#587c0c',
	'gitDecoration-conflictingResourceForeground': '#ad0707',
	'gitDecoration-deletedResourceForeground': '#ad0707',
	'gitDecoration-modifiedResourceForeground': '#895503',
	'input-background': '#ffffff',
	'input-border': '#cecece',
	'input-foreground': '#3b3b3b',
	'inputOption-activeBackground': 'rgba(0, 95, 184, 0.15)',
	'inputOption-activeBorder': '#005fb8',
	'inputOption-activeForeground': '#000000',
	'inputValidation-errorBorder': '#be1100',
	'keybindingLabel-background': 'rgba(221, 221, 221, 0.4)',
	'keybindingLabel-foreground': '#3b3b3b',
	'list-activeSelectionBackground': '#e8e8e8',
	'list-activeSelectionForeground': '#000000',
	'list-dropBackground': '#d6ebff',
	'list-hoverBackground': '#f2f2f2',
	'menu-background': '#ffffff',
	'menu-border': '#cecece',
	'menu-foreground': '#3b3b3b',
	'menu-selectionBackground': '#005fb8',
	'menu-selectionForeground': '#ffffff',
	'testing-iconPassed': '#388a34',
	'toolbar-hoverBackground': 'rgba(184, 184, 184, 0.31)',
	'toolbar-activeBackground': 'rgba(166, 166, 166, 0.31)',
	'button-secondaryHoverBackground': '#cccccc',
	'sideBar-background': '#f8f8f8',
	'widget-shadow': 'rgba(0, 0, 0, 0.16)',
	disabledForeground: 'rgba(97, 97, 97, 0.5)',
	'gitDecoration-untrackedResourceForeground': '#007100',
	'charts-red': '#e51400',
	'charts-blue': '#1a85ff',
	'charts-yellow': '#bf8803',
	'charts-orange': '#d18616',
	'charts-green': '#388a34',
	'charts-purple': '#652d90',
	'terminal-ansiMagenta': '#bc05bc',
	'terminal-ansiCyan': '#0598bc',
	'checkbox-background': '#f8f8f8',
	'checkbox-border': '#cecece',
};

const variables = (map: Record<string, string>): string =>
	Object.entries(map)
		.map(([name, value]) => `--vscode-${name}: ${value};`)
		.join('\n\t');

export const THEME_CSS = `:root { ${variables(MAP_SHARED)} }
:root[data-theme='dark'] { color-scheme: dark; ${variables(MAP_DARK)} }
:root[data-theme='light'] { color-scheme: light; ${variables(MAP_LIGHT)} }
html, body { height: 100%; margin: 0; }
body {
	background: var(--vscode-editor-background);
	color: var(--vscode-foreground);
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
}
#app { height: 100%; }`;

export const CSP = [
	`default-src 'none'`,
	`img-src app: https: data:`,
	`font-src app:`,
	`style-src app: 'unsafe-inline'`,
	`script-src app:`,
].join('; ');

export function renderPage(theme: ThemeKind): string {
	return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<link rel="stylesheet" href="app://git-octopus/webview.css" />
<style>${THEME_CSS}</style>
<title>Git Octopus</title>
</head>
<body class="vscode-${theme}">
<div id="app"></div>
<script type="module" src="app://git-octopus/webview.js"></script>
</body>
</html>`;
}

/** The strip of tabs across the top of the window: its own small page, on the same theme. */
export function renderTabsPage(theme: ThemeKind): string {
	return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<link rel="stylesheet" href="app://git-octopus/tabs/tabs.css" />
<style>${THEME_CSS}</style>
<title>Git Octopus</title>
</head>
<body>
<div id="tabs"></div>
<script type="module" src="app://git-octopus/tabs/tabs.js"></script>
</body>
</html>`;
}
