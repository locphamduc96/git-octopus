// Copies the packed app into /Applications, replacing the one there. Quits it first if it is running,
// since a running app cannot be swapped out cleanly.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '../release/mac-arm64/Git Octopus.app');
const target = '/Applications/Git Octopus.app';
if (!existsSync(source)) throw new Error(`${source} is missing — run \`pnpm desktop:dist\` first.`);

try {
	execFileSync('osascript', [
		'-e',
		'if application "Git Octopus" is running then tell application "Git Octopus" to quit',
	]);
} catch {
	// Not running, or AppleScript unavailable: either way there is nothing to wait for.
}
rmSync(target, { recursive: true, force: true });
execFileSync('ditto', [source, target]);
console.log(`Installed ${target} — open it with Spotlight (⌘ Space, "Git Octopus").`);
