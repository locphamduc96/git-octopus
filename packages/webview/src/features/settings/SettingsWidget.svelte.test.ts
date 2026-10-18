import { fireEvent, render, screen } from '@testing-library/svelte';
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

describe('SettingsWidget Desktop section', () => {
	const onchange = vi.fn();

	function renderDesktop(settings = { ...DEFAULT_VIEW_SETTINGS }) {
		dispatchHostMessage({ type: 'capabilities', desktop: true, editorDiff: false });
		onchange.mockClear();
		return render(SettingsWidget, {
			settings,
			identity: null,
			listIdentities: [],
			listWorkspaceIdentities: [],
			suggestedIdentity: null,
			onapplyIdentity: () => {},
			onclearIdentityOverride: () => {},
			onsaveIdentities: () => {},
			onchange,
			onclose: () => {},
		});
	}

	it('is not there in the VS Code extension', () => {
		dispatchHostMessage({ type: 'capabilities', desktop: false, editorDiff: true });
		render(SettingsWidget, {
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
		expect(screen.queryByRole('region', { name: 'Desktop' })).toBeNull();
		for (const label of ['Theme', 'Git path', 'External editor', 'Terminal app']) {
			expect(screen.queryByLabelText(label)).toBeNull();
		}
	});

	it('holds Theme, Git path, External editor and Terminal app in the desktop app', () => {
		renderDesktop();
		const section = screen.getByRole('region', { name: 'Desktop' });
		for (const label of ['Theme', 'Git path', 'External editor', 'Terminal app']) {
			expect(section.contains(screen.getByLabelText(label))).toBe(true);
		}
	});

	it('offers System, Light and Dark, starting on System, and saves the pick', async () => {
		renderDesktop();
		const select = screen.getByLabelText('Theme') as HTMLSelectElement;
		expect(select.value).toBe('system');
		expect([...select.options].map((option) => option.textContent)).toEqual([
			'System',
			'Light',
			'Dark',
		]);
		await fireEvent.change(select, { target: { value: 'dark' } });
		expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
	});

	it('shows the saved Git path and saves a new one without its stray spaces', async () => {
		renderDesktop({ ...DEFAULT_VIEW_SETTINGS, gitPath: '/opt/homebrew/bin/git' });
		const input = screen.getByLabelText('Git path') as HTMLInputElement;
		expect(input.value).toBe('/opt/homebrew/bin/git');
		await fireEvent.change(input, { target: { value: '  /usr/local/bin/git ' } });
		expect(onchange).toHaveBeenCalledWith(
			expect.objectContaining({ gitPath: '/usr/local/bin/git' })
		);
	});

	it('saves an emptied Git path, which means the git on the PATH', async () => {
		renderDesktop({ ...DEFAULT_VIEW_SETTINGS, gitPath: '/opt/git' });
		await fireEvent.change(screen.getByLabelText('Git path'), { target: { value: '' } });
		expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ gitPath: '' }));
	});

	it('lists the known editors, and asks for a command only for a custom one', async () => {
		renderDesktop();
		const select = screen.getByLabelText('External editor') as HTMLSelectElement;
		expect([...select.options].map((option) => option.textContent)).toEqual([
			'Automatic',
			'VS Code',
			'Cursor',
			'Zed',
			'Sublime Text',
			'Custom command',
		]);
		expect(screen.queryByLabelText('Editor command')).toBeNull();
		await fireEvent.change(select, { target: { value: 'zed' } });
		expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ externalEditor: 'zed' }));
	});

	it('shows the command field for a custom editor and saves what is typed in it', async () => {
		renderDesktop({
			...DEFAULT_VIEW_SETTINGS,
			externalEditor: 'custom',
			externalEditorCommand: 'subl --wait {file}',
		});
		const input = screen.getByLabelText('Editor command') as HTMLInputElement;
		expect(input.value).toBe('subl --wait {file}');
		await fireEvent.change(input, { target: { value: 'nvim-qt {file}' } });
		expect(onchange).toHaveBeenCalledWith(
			expect.objectContaining({ externalEditor: 'custom', externalEditorCommand: 'nvim-qt {file}' })
		);
	});

	it('falls back to Automatic for a value the list does not know', async () => {
		renderDesktop();
		const select = screen.getByLabelText('External editor') as HTMLSelectElement;
		const stale = document.createElement('option');
		stale.value = 'emacs';
		select.append(stale);
		await fireEvent.change(select, { target: { value: 'emacs' } });
		expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ externalEditor: 'auto' }));
	});
});

describe('SettingsWidget branches panel row', () => {
	const onchange = vi.fn();

	function renderWith(showBranchesPanel: boolean | null) {
		return render(SettingsWidget, {
			settings: { ...DEFAULT_VIEW_SETTINGS, showBranchesPanel },
			identity: null,
			listIdentities: [],
			listWorkspaceIdentities: [],
			suggestedIdentity: null,
			onapplyIdentity: () => {},
			onclearIdentityOverride: () => {},
			onsaveIdentities: () => {},
			onchange,
			onclose: () => {},
		});
	}

	function checkbox(): HTMLInputElement {
		return screen.getByLabelText('Show branches panel') as HTMLInputElement;
	}

	it('shows the shell default until the user chooses, and the choice after that', () => {
		dispatchHostMessage({ type: 'capabilities', desktop: false, editorDiff: true });
		const extension = renderWith(null);
		expect(checkbox().checked).toBe(false);
		extension.unmount();

		dispatchHostMessage({ type: 'capabilities', desktop: true, editorDiff: false });
		const desktop = renderWith(null);
		expect(checkbox().checked).toBe(true);
		desktop.unmount();

		renderWith(false);
		expect(checkbox().checked).toBe(false);
	});

	it('saves an explicit choice, even one that matches the shell default', () => {
		dispatchHostMessage({ type: 'capabilities', desktop: true, editorDiff: false });
		onchange.mockClear();
		renderWith(null);
		checkbox().click();
		expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ showBranchesPanel: false }));
	});
});
