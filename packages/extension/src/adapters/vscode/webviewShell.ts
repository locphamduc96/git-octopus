import * as vscode from 'vscode';

/*
 * Placeholder painted straight into the document, before the bundle is fetched and Svelte mounts —
 * the window between the two is short but it is the one where the panel would otherwise be blank.
 * It stands alone on purpose: `tokens.css` is not loaded yet, so this reads the VS Code theme
 * variables directly, and `main.ts` clears it the moment the real view takes over.
 */
const BOOT_ROW_H = 34;
const BOOT_ROWS = 14;
const BOOT_SKELETON_CSS = `
#boot-skeleton { display: flex; flex-direction: column; height: 100%; overflow: hidden;
	mask-image: linear-gradient(to bottom, #000 55%, transparent 100%); }
#boot-skeleton .boot-bar { flex: none; height: 30px; box-sizing: border-box;
	border-bottom: 1px solid var(--vscode-panel-border); }
#boot-skeleton .boot-row { flex: none; display: flex; align-items: center; gap: 8px;
	height: ${BOOT_ROW_H}px; padding: 0 12px; }
#boot-skeleton .boot-cell { height: 9px; border-radius: 3px;
	background: color-mix(in srgb, var(--vscode-foreground) 13%, transparent); }
#boot-skeleton .boot-ref { width: 70px; height: 14px; border-radius: 4px; }
#boot-skeleton .boot-node { flex: none; width: 8px; height: 8px; border-radius: 50%;
	margin: 0 32px; background: color-mix(in srgb, var(--vscode-foreground) 25%, transparent); }
#boot-skeleton .boot-subject { flex: none; }
#boot-skeleton .boot-date { flex: none; width: 90px; margin-left: auto; }
`;
/** Subject widths, as a share of the row — a column of identical bars does not read as commits. */
const BOOT_SUBJECT_W = [52, 40, 62, 46, 34, 58, 42, 60, 37, 49];
const BOOT_SKELETON_HTML = `<div id="boot-skeleton" aria-hidden="true">
	<div class="boot-bar"></div>
	<div class="boot-bar"></div>
	${Array.from(
		{ length: BOOT_ROWS },
		(_, i) =>
			`<div class="boot-row"><span class="boot-cell boot-ref"></span>` +
			`<span class="boot-node"></span>` +
			`<span class="boot-cell boot-subject" style="width:${BOOT_SUBJECT_W[i % BOOT_SUBJECT_W.length]}%"></span>` +
			`<span class="boot-cell boot-date"></span></div>`
	).join('')}
</div>`;

/**
 * The full HTML document served into a webview: CSP, the boot skeleton, and the bundle.
 */
export function renderWebviewHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'webview.js'));
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'webview.css'));
	const nonce = createNonce();
	const csp = [
		`default-src 'none'`,
		`img-src ${webview.cspSource} https: data:`,
		`font-src ${webview.cspSource}`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		// The nonce covers the entry script; cspSource is for the grammar chunks it lazily
		// imports — a dynamic import() does not inherit the importer's nonce.
		`script-src ${webview.cspSource} 'nonce-${nonce}'`,
	].join('; ');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${styleUri}" />
<style>${BOOT_SKELETON_CSS}</style>
<title>Git Octopus</title>
</head>
<body>
<div id="app">${BOOT_SKELETON_HTML}</div>
<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function createNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}
