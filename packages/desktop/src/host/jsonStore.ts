import { mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import * as path from 'node:path';
import type { KeyValueStore, Settings } from '@git-octopus/host/app/ports/shell';

/**
 * Settings or state kept as one JSON object in a file under the app's data folder.
 *
 * Every window runs a host process of its own, so several processes share each file. Reads come
 * from memory, kept current by watching the file; a write re-reads the file first and changes only
 * its own key, then replaces the file in one rename — two windows saving different keys at once
 * both land, and nobody ever reads half a file.
 */
export class JsonStore implements KeyValueStore, Settings {
	private mapValues: Record<string, unknown>;
	private watcher: FSWatcher | null = null;

	/** `onUpdate` hears of this process's own writes, after they landed. */
	public constructor(
		private readonly file: string,
		private readonly onUpdate?: (key: string, value: unknown) => void
	) {
		mkdirSync(path.dirname(file), { recursive: true });
		this.mapValues = this.read();
		try {
			this.watcher = watch(path.dirname(file), (_event, name) => {
				if (name === path.basename(file)) this.mapValues = this.read();
			});
		} catch {
			// Without a watch, this window just won't see another window's later writes.
		}
	}

	public get<T>(key: string): T | undefined;
	public get<T>(key: string, fallback: T): T;
	public get<T>(key: string, fallback?: T): T | undefined {
		return key in this.mapValues ? (this.mapValues[key] as T) : fallback;
	}

	public update(key: string, value: unknown): Promise<void> {
		const mapLatest = this.read();
		if (value === undefined) delete mapLatest[key];
		else mapLatest[key] = value;
		const temp = `${this.file}.${process.pid}.tmp`;
		writeFileSync(temp, `${JSON.stringify(mapLatest, null, '\t')}\n`);
		renameSync(temp, this.file);
		this.mapValues = mapLatest;
		this.onUpdate?.(key, value);
		return Promise.resolve();
	}

	public dispose(): void {
		this.watcher?.close();
	}

	private read(): Record<string, unknown> {
		try {
			const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
			return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
		} catch {
			return {};
		}
	}
}

/** The keys of one folder, inside a store shared by every folder: workspace state, per window. */
export function scoped(store: KeyValueStore, scope: string): KeyValueStore {
	const prefix = `${scope}\u0000`;
	return {
		get: ((key: string, fallback?: unknown) =>
			store.get(`${prefix}${key}`, fallback)) as KeyValueStore['get'],
		update: (key, value) => store.update(`${prefix}${key}`, value),
	};
}
