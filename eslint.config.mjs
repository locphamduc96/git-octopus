import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
	{
		ignores: [
			'**/dist/**',
			'**/media/**',
			'**/node_modules/**',
			'**/*.vsix',
			// E2E: the downloaded VS Code, and what a run leaves behind.
			'**/.vscode-test/**',
			'**/playwright-report/**',
			'**/test-results/**',
			'**/.cache/**',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser,
			},
		},
	},
	{
		// Node-run build/config scripts.
		files: ['**/*.mjs', '**/*.config.{js,ts,mjs}', '**/esbuild.mjs'],
		languageOptions: {
			globals: {
				process: 'readonly',
				console: 'readonly',
				__dirname: 'readonly',
				URL: 'readonly',
			},
		},
	},
	{
		// Browser-side webview code. TypeScript + svelte-check already resolve DOM types,
		// so `no-undef` (which doesn't know the DOM lib) only produces false positives here.
		files: ['packages/webview/**/*.{ts,svelte}'],
		languageOptions: {
			globals: {
				window: 'readonly',
				document: 'readonly',
			},
		},
		rules: {
			'no-undef': 'off',
		},
	},
	{
		// The ports & adapters boundary, enforced rather than reviewed. `core/` is the domain and
		// `app/` orchestrates it; neither may reach an adapter, the editor API, or the filesystem —
		// a dependency they need is declared as a port and handed in.
		//
		// Test files are exempt on purpose: a test in `core/` that drives the real process executor
		// is an integration test, and moving it elsewhere would buy nothing.
		files: ['packages/extension/src/{app,core}/**/*.ts'],
		ignores: ['**/*.test.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/adapters/**'],
							message:
								'app/ and core/ must not import an adapter — declare a port in app/ports and inject the implementation.',
						},
						{
							group: ['node:*', 'vscode'],
							message:
								'app/ and core/ must stay free of the editor API and node builtins so they can be tested without either.',
						},
					],
				},
			],
		},
	},
	{
		// Playwright reads a hook's first argument as a fixture list and demands the destructuring
		// form, so a hook that needs only `testInfo` has to write `({}, testInfo)`.
		files: ['packages/e2e/**/*.ts'],
		rules: {
			'no-empty-pattern': 'off',
		},
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
		},
	}
);
