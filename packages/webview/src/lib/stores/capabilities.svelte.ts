import type { HostCapabilities } from '@git-octopus/shared';
import { onHostType } from '../hostRouter';

/** VS Code's: it never sends any, so what the view assumes until told otherwise is what it offers. */
let current = $state<HostCapabilities>({ desktop: false, editorDiff: true });

onHostType('capabilities', ({ desktop, editorDiff }) => {
	current = { desktop, editorDiff };
});

export const capabilities = {
	get desktop(): boolean {
		return current.desktop;
	},
	get editorDiff(): boolean {
		return current.editorDiff;
	},
};
