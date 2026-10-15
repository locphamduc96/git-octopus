import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { VSCODE_CACHE, VSCODE_VERSION } from './paths.js';

/**
 * The pinned VS Code's executable, downloaded once into the cache. On macOS the binary is now named
 * `Code`, while `@vscode/test-electron` still answers with the old `Electron` path.
 */
export async function vscodeExecutable(): Promise<string> {
	const reported = await downloadAndUnzipVSCode({
		version: VSCODE_VERSION,
		cachePath: VSCODE_CACHE,
	});
	if (existsSync(reported)) return reported;
	const renamed = path.join(path.dirname(reported), 'Code');
	if (existsSync(renamed)) return renamed;
	throw new Error(`No VS Code executable at ${reported} or ${renamed}.`);
}
