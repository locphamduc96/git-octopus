import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The VS Code the suite drives: pinned, so a VS Code update never moves the workbench under it. */
export const VSCODE_VERSION = '1.140.0';

export const E2E_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(E2E_ROOT, '../..');
export const EXTENSION_ROOT = path.join(REPO_ROOT, 'packages/extension');
export const VSCODE_CACHE = path.join(E2E_ROOT, '.vscode-test');
/** Reused between runs and wiped at the start of each session — never a fresh folder per run. */
export const STATE_DIR = path.join(E2E_ROOT, '.cache');
export const FIXTURE_SCRIPT = path.join(E2E_ROOT, 'fixtures/review-repo.sh');
export const FAKE_BIN = path.join(E2E_ROOT, 'fixtures/bin');
