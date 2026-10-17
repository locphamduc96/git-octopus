import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('acquireVsCodeApi', () => ({
	postMessage: () => undefined,
	getState: () => undefined,
	setState: () => undefined,
}));

const { dispatchHostMessage } = await import('../../lib/hostRouter');
const { DEFAULT_VIEW_SETTINGS } = await import('../../lib/viewSettings');
const { default: SettingsWidget } = await import('./SettingsWidget.svelte');

function renderWidget() {
	return render(SettingsWidget, {
		settings: { ...DEFAULT_VIEW_SETTINGS },
		identity: null,
		listIdentities: [],
		listWorkspaceIdentities: [],
		suggestedIdentity: null,
		onapplyIdentity: () => {},
		onclearIdentityOverride: () => {},
		onsaveIdentities: () => {},
		onchange: () => {},
		onclose: () => {},
	});
}

describe('SettingsWidget terminal app row', () => {
	it('is hidden for the VS Code extension and shown in the desktop app', () => {
		dispatchHostMessage({ type: 'capabilities', desktop: false, editorDiff: true });
		const first = renderWidget();
		expect(screen.queryByLabelText('Terminal app')).toBeNull();
		first.unmount();

		dispatchHostMessage({ type: 'capabilities', desktop: true, editorDiff: false });
		renderWidget();
		const select = screen.getByLabelText('Terminal app') as HTMLSelectElement;
		expect(select.value).toBe('Terminal');
		expect([...select.options].map((option) => option.value)).toEqual([
			'Terminal',
			'iTerm',
			'Ghostty',
			'Warp',
		]);
	});
});
