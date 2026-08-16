import * as vscode from 'vscode';
import type { FileIconTheme } from '@git-octopus/shared';
import { buildIconTheme, type RawIconTheme } from '../../core/icons/iconTheme.js';

/**
 * A file-icon theme located on disk. Icon paths are resolved per webview, since a webview URI is
 * only valid for the webview that minted it.
 */
export interface LocatedIconTheme {
	raw: RawIconTheme;
	/** Directory the theme file sits in; icon paths are relative to it. */
	dir: vscode.Uri;
	/** Root of the contributing extension, which the webview needs permission to read from. */
	root: vscode.Uri;
}

/**
 * Find the icon theme the user has chosen and read it.
 *
 * VS Code renders file icons itself and offers no API for them, but the theme is just a JSON file
 * inside whichever extension contributes it — including the built-in ones — so we can read it the
 * same way VS Code does. Returns null when icons are switched off (`workbench.iconTheme: null`) or
 * the contributing extension is gone, and the caller falls back to codicons.
 */
export async function locateIconTheme(): Promise<LocatedIconTheme | null> {
	const id = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme');
	if (!id) return null;

	for (const extension of vscode.extensions.all) {
		const listThemes = extension.packageJSON?.contributes?.iconThemes;
		if (!Array.isArray(listThemes)) continue;
		const theme = listThemes.find((item: { id?: string }) => item?.id === id);
		if (!theme?.path) continue;

		const file = vscode.Uri.joinPath(extension.extensionUri, theme.path);
		try {
			const bytes = await vscode.workspace.fs.readFile(file);
			return {
				raw: JSON.parse(new TextDecoder().decode(bytes)) as RawIconTheme,
				dir: vscode.Uri.joinPath(file, '..'),
				root: extension.extensionUri,
			};
		} catch {
			// A theme we cannot read is the same as no theme: fall back rather than break the view.
			return null;
		}
	}
	return null;
}

/** Flatten a located theme into lookup tables whose URIs `webview` is allowed to load. */
export function buildForWebview(located: LocatedIconTheme, webview: vscode.Webview): FileIconTheme {
	const kind = vscode.window.activeColorTheme.kind;
	return buildIconTheme(located.raw, {
		resolve: (path) => webview.asWebviewUri(vscode.Uri.joinPath(located.dir, path)).toString(),
		light: kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight,
		...collectLanguages(),
	});
}

/**
 * Extensions and file names each language is registered for, gathered from every extension's
 * `contributes.languages`. A theme that maps icons by language id resolves through this.
 */
function collectLanguages(): {
	mapLanguageExtensions: Record<string, string[]>;
	mapLanguageFileNames: Record<string, string[]>;
} {
	const mapLanguageExtensions: Record<string, string[]> = {};
	const mapLanguageFileNames: Record<string, string[]> = {};

	for (const extension of vscode.extensions.all) {
		const listLanguages = extension.packageJSON?.contributes?.languages;
		if (!Array.isArray(listLanguages)) continue;
		for (const language of listLanguages as {
			id?: string;
			extensions?: string[];
			filenames?: string[];
		}[]) {
			if (!language?.id) continue;
			for (const extensionName of language.extensions ?? []) {
				(mapLanguageExtensions[language.id] ??= []).push(
					extensionName.replace(/^\./, '').toLowerCase()
				);
			}
			for (const name of language.filenames ?? []) {
				(mapLanguageFileNames[language.id] ??= []).push(name.toLowerCase());
			}
		}
	}
	return { mapLanguageExtensions, mapLanguageFileNames };
}
