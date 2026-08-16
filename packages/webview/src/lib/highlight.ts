/**
 * Syntax highlighting for the inline diff panel, on Shiki's fine-grained core: no wasm (the
 * JavaScript regex engine covers the bundled grammars), and no grammar is downloaded until a file
 * of that language is actually opened.
 */
import type { HighlighterCore, LanguageRegistration, ThemeRegistration } from 'shiki/core';

export type ColorThemeKind = 'dark' | 'light';

/** One coloured slice of a line. `color` is absent when the theme keeps the default foreground. */
export interface HighlightToken {
	content: string;
	color?: string;
}

type LangLoader = () => Promise<{ default: LanguageRegistration[] }>;

/**
 * Vite can only code-split a dynamic import written out verbatim, so every grammar gets its own
 * literal `import()` — this map is what makes each of them a separate lazy chunk.
 */
const mapLangLoaders: Record<string, LangLoader> = {
	bat: () => import('@shikijs/langs/bat'),
	c: () => import('@shikijs/langs/c'),
	cpp: () => import('@shikijs/langs/cpp'),
	csharp: () => import('@shikijs/langs/csharp'),
	css: () => import('@shikijs/langs/css'),
	dart: () => import('@shikijs/langs/dart'),
	docker: () => import('@shikijs/langs/docker'),
	go: () => import('@shikijs/langs/go'),
	graphql: () => import('@shikijs/langs/graphql'),
	html: () => import('@shikijs/langs/html'),
	ini: () => import('@shikijs/langs/ini'),
	java: () => import('@shikijs/langs/java'),
	javascript: () => import('@shikijs/langs/javascript'),
	json: () => import('@shikijs/langs/json'),
	jsonc: () => import('@shikijs/langs/jsonc'),
	jsx: () => import('@shikijs/langs/jsx'),
	kotlin: () => import('@shikijs/langs/kotlin'),
	less: () => import('@shikijs/langs/less'),
	lua: () => import('@shikijs/langs/lua'),
	make: () => import('@shikijs/langs/make'),
	markdown: () => import('@shikijs/langs/markdown'),
	'objective-c': () => import('@shikijs/langs/objective-c'),
	php: () => import('@shikijs/langs/php'),
	powershell: () => import('@shikijs/langs/powershell'),
	python: () => import('@shikijs/langs/python'),
	ruby: () => import('@shikijs/langs/ruby'),
	rust: () => import('@shikijs/langs/rust'),
	scss: () => import('@shikijs/langs/scss'),
	shellscript: () => import('@shikijs/langs/shellscript'),
	sql: () => import('@shikijs/langs/sql'),
	svelte: () => import('@shikijs/langs/svelte'),
	swift: () => import('@shikijs/langs/swift'),
	toml: () => import('@shikijs/langs/toml'),
	tsx: () => import('@shikijs/langs/tsx'),
	typescript: () => import('@shikijs/langs/typescript'),
	vue: () => import('@shikijs/langs/vue'),
	xml: () => import('@shikijs/langs/xml'),
	yaml: () => import('@shikijs/langs/yaml'),
};

const mapExtLang: Record<string, string> = {
	bash: 'shellscript',
	bat: 'bat',
	c: 'c',
	cc: 'cpp',
	cjs: 'javascript',
	cmd: 'bat',
	cpp: 'cpp',
	cs: 'csharp',
	css: 'css',
	cts: 'typescript',
	cxx: 'cpp',
	dart: 'dart',
	go: 'go',
	gql: 'graphql',
	graphql: 'graphql',
	h: 'c',
	hpp: 'cpp',
	htm: 'html',
	html: 'html',
	hxx: 'cpp',
	ini: 'ini',
	java: 'java',
	js: 'javascript',
	json: 'json',
	jsonc: 'jsonc',
	jsx: 'jsx',
	kt: 'kotlin',
	kts: 'kotlin',
	less: 'less',
	lua: 'lua',
	m: 'objective-c',
	markdown: 'markdown',
	md: 'markdown',
	mjs: 'javascript',
	mk: 'make',
	mm: 'objective-c',
	mts: 'typescript',
	php: 'php',
	ps1: 'powershell',
	py: 'python',
	rb: 'ruby',
	rs: 'rust',
	scss: 'scss',
	sh: 'shellscript',
	sql: 'sql',
	svelte: 'svelte',
	svg: 'xml',
	swift: 'swift',
	toml: 'toml',
	ts: 'typescript',
	tsx: 'tsx',
	vue: 'vue',
	xml: 'xml',
	yaml: 'yaml',
	yml: 'yaml',
	zsh: 'shellscript',
};

/** Files whose language lives in the name, not an extension. Keys are lowercase. */
const mapNameLang: Record<string, string> = {
	dockerfile: 'docker',
	gnumakefile: 'make',
	makefile: 'make',
};

/** Shiki language id for a repository path, or null when the file cannot be highlighted. */
export function langForPath(path: string): string | null {
	const name = path.split('/').pop()?.toLowerCase() ?? '';
	const fromName = mapNameLang[name];
	if (fromName) return fromName;
	const dot = name.lastIndexOf('.');
	// `<= 0` also skips dotfiles such as `.gitignore` — their "extension" is the whole name.
	if (dot <= 0 || dot === name.length - 1) return null;
	return mapExtLang[name.slice(dot + 1)] ?? null;
}

/** Fallback until the host's `colorTheme` message arrives, read from VS Code's body classes. */
export function guessThemeKind(body: {
	classList: { contains(name: string): boolean };
}): ColorThemeKind {
	return body.classList.contains('vscode-light') ||
		body.classList.contains('vscode-high-contrast-light')
		? 'light'
		: 'dark';
}

const mapThemes: Record<
	ColorThemeKind,
	{ name: string; load: () => Promise<{ default: ThemeRegistration }> }
> = {
	dark: { name: 'dark-plus', load: () => import('@shikijs/themes/dark-plus') },
	light: { name: 'light-plus', load: () => import('@shikijs/themes/light-plus') },
};

let corePromise: Promise<HighlighterCore> | null = null;

function getCore(): Promise<HighlighterCore> {
	corePromise ??= (async () => {
		const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
			import('shiki/core'),
			import('shiki/engine/javascript'),
		]);
		// `forgiving`: a grammar rule the JS engine cannot translate loses that one rule's colours
		// instead of throwing the whole language away.
		return createHighlighterCore({ engine: createJavaScriptRegexEngine({ forgiving: true }) });
	})();
	return corePromise;
}

/**
 * Grammars and themes load once each; a failed load stays failed, so a broken grammar costs one
 * rejected import rather than a retry on every diff of that language.
 */
const mapLoads = new Map<string, Promise<boolean>>();

function loadOnce(key: string, run: () => Promise<void>): Promise<boolean> {
	let pending = mapLoads.get(key);
	if (!pending) {
		pending = run().then(
			() => true,
			() => false
		);
		mapLoads.set(key, pending);
	}
	return pending;
}

/**
 * Tokenize each hunk's lines with the grammar for `lang`, resolving to one token list per line,
 * flattened in hunk order. Hunks are tokenized independently and never see the rest of the file,
 * so a hunk cutting through a block comment or template string can colour a few lines wrong —
 * the accepted price for not fetching full file contents.
 *
 * Resolves to null when the language or theme cannot be used; the caller keeps rendering plain.
 */
export async function tokenizeHunks(
	lang: string,
	listHunkTexts: string[][],
	kind: ColorThemeKind
): Promise<HighlightToken[][] | null> {
	const loader = mapLangLoaders[lang];
	if (!loader) return null;
	try {
		const core = await getCore();
		const [langOk, themeOk] = await Promise.all([
			loadOnce(`lang:${lang}`, async () => core.loadLanguage((await loader()).default)),
			loadOnce(`theme:${kind}`, async () => core.loadTheme((await mapThemes[kind].load()).default)),
		]);
		if (!langOk || !themeOk) return null;
		const listResult: HighlightToken[][] = [];
		for (const listTexts of listHunkTexts) {
			if (listTexts.length === 0) continue;
			const listLines = core.codeToTokensBase(listTexts.join('\n'), {
				lang,
				theme: mapThemes[kind].name,
			});
			// The tokenizer must give back exactly one row per input line: anything else would shift
			// every later line of the virtual-scroll column, which is far worse than no colour.
			if (listLines.length !== listTexts.length) return null;
			for (const listTokens of listLines) {
				listResult.push(
					listTokens.map((token) => ({ content: token.content, color: token.color }))
				);
			}
		}
		return listResult;
	} catch {
		return null;
	}
}
