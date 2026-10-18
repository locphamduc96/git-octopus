import type { ThemeKind } from '../ipc.js';
import { CSP, THEME_CSS } from '../main/page.js';

/** The Welcome page's document, on the same theme variables as the tab strip and the views. */
export function renderWelcomePage(theme: ThemeKind): string {
	return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<link rel="stylesheet" href="app://git-octopus/welcome/welcome.css" />
<style>${THEME_CSS}</style>
<title>Git Octopus</title>
</head>
<body>
<div id="welcome"></div>
<script type="module" src="app://git-octopus/welcome/welcome.js"></script>
</body>
</html>`;
}
