import { postToHost } from '../bridge';
import { onHostType, onRepoReset } from '../hostRouter';
import { postToDesktop } from './desktopHost';

/** The Markdown the host asked the view to show — an AI explanation in the desktop app. */
export interface ShownMarkdown {
	title: string;
	content: string;
}

const FILE_NAME_MAX = 80;

let shown = $state<ShownMarkdown | null>(null);

onHostType('showMarkdown', ({ title, content }) => {
	shown = { title, content };
});

// An explanation of one repository's commit has no place over another repository.
onRepoReset(() => {
	shown = null;
});

export const markdownPanel = {
	get shown(): ShownMarkdown | null {
		return shown;
	},
	close(): void {
		shown = null;
	},
	copy(text: string): void {
		postToHost({ type: 'copyText', text, label: 'explanation' });
	},
	/** The host asks where to save and writes the file; the name only suggests one. */
	save(content: string): void {
		const title = shown?.title.trim() ?? '';
		postToDesktop({
			type: 'saveMarkdown',
			content,
			suggestedName: `${(title || 'Explanation').slice(0, FILE_NAME_MAX)}.md`,
		});
	},
	/** The host opens it, and only when it is `https:`. */
	openLink(url: string): void {
		postToDesktop({ type: 'openLink', url });
	},
};
