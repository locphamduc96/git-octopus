import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
	{
		ignores: ['**/dist/**', '**/media/**', '**/node_modules/**', '**/*.vsix'],
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
		// Browser-side webview code.
		files: ['packages/webview/**/*.{ts,svelte}'],
		languageOptions: {
			globals: {
				window: 'readonly',
				document: 'readonly',
				MessageEvent: 'readonly',
			},
		},
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
		},
	}
);
