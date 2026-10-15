import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { EXTENSION_ROOT } from './paths.js';
import { vscodeExecutable } from './vscodeBinary.js';

/** Fetch the pinned VS Code once, and refuse to run against an extension that was never built. */
export default async function globalSetup(): Promise<void> {
	for (const built of ['dist/extension.js', 'media/webview/index.html']) {
		if (!existsSync(path.join(EXTENSION_ROOT, built))) {
			throw new Error(
				`packages/extension/${built} is missing — run \`pnpm e2e\` from the repo root, which builds first.`
			);
		}
	}
	process.env.GIT_OCTOPUS_E2E_VSCODE = await vscodeExecutable();
}
