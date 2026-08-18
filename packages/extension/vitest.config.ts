import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			// `vscode` only exists inside the editor, so an adapter cannot be imported in a test
			// without standing in for it. The stub records calls instead of making them.
			vscode: path.resolve(__dirname, 'src/test/vscodeStub.ts'),
		},
	},
});
