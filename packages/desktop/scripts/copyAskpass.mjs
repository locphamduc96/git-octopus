import { chmodSync, cpSync, rmSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Puts the askpass helper (`askpass.sh`, `askpass-main.cjs`) into the desktop build. Git runs
 * `askpass.sh` itself, so it has to be executable where it ends up; the mode is set here, at build
 * time, because inside an installed `.app` the host may not be able to change it.
 */
export function copyAskpassHelper(source, dest) {
	rmSync(dest, { recursive: true, force: true });
	cpSync(source, dest, { recursive: true });
	chmodSync(path.join(dest, 'askpass.sh'), 0o755);
}
