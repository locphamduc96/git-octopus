import type { HostNoticeMessage, HostProgressMessage } from '@git-octopus/shared';
import { postToHost } from '../bridge';
import { onHostType } from '../hostRouter';

/**
 * Notices and running tasks from a host with no notifications of its own — the desktop app. VS Code
 * shows its own and sends none of these, so in the editor this stays empty.
 */
export type HostNotice = Omit<HostNoticeMessage, 'type'>;
export type HostTask = Pick<HostProgressMessage, 'id' | 'title' | 'message' | 'cancellable'>;

/** How long a plain information notice stays; anything that asks something waits for an answer. */
const INFO_MS = 6000;

let listNotices = $state<HostNotice[]>([]);
let listTasks = $state<HostTask[]>([]);

function remove(id: number): HostNotice | undefined {
	const notice = listNotices.find((item) => item.id === id);
	listNotices = listNotices.filter((item) => item.id !== id);
	return notice;
}

onHostType('hostNotice', ({ id, level, message, listActions }) => {
	listNotices = [...listNotices, { id, level, message, listActions }];
	if (level === 'info' && listActions.length === 0) setTimeout(() => remove(id), INFO_MS);
});

onHostType('hostProgress', ({ id, title, message, cancellable, done }) => {
	if (done) {
		listTasks = listTasks.filter((task) => task.id !== id);
		return;
	}
	const task = { id, title, message, cancellable };
	listTasks = listTasks.some((item) => item.id === id)
		? listTasks.map((item) => (item.id === id ? task : item))
		: [...listTasks, task];
});

export const hostNotices = {
	get list(): HostNotice[] {
		return listNotices;
	},
	get tasks(): HostTask[] {
		return listTasks;
	},
	/** Close a notice, with the action chosen or none; the host only waits on notices that ask. */
	answer(id: number, action?: string): void {
		const notice = remove(id);
		if (notice && notice.listActions.length > 0) {
			postToHost({ type: 'hostNoticeReply', id, ...(action ? { action } : {}) });
		}
	},
	cancel(id: number): void {
		postToHost({ type: 'hostProgressCancel', id });
	},
};
