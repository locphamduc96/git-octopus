import { access } from 'node:fs/promises';

/** Whether a path exists on disk, without caring what it is. */
export async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
