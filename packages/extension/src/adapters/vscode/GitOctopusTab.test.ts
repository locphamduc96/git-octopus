import { beforeEach, describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { GitOctopusTab, pickGraphLocation } from './GitOctopusTab.js';
import {
	Uri,
	makeWebviewPanel,
	recorded,
	resetRecorded,
	type StubWebviewPanel,
} from '../../test/vscodeStub.js';

interface FakeHost {
	listAttached: unknown[];
	listVisibility: [unknown, boolean][];
	attach(webview: unknown): Promise<void>;
	setWebviewVisible(webview: unknown, visible: boolean): void;
}

function fakeHost(): FakeHost {
	const host: FakeHost = {
		listAttached: [],
		listVisibility: [],
		attach: (webview) => {
			host.listAttached.push(webview);
			return Promise.resolve();
		},
		setWebviewVisible: (webview, visible) => void host.listVisibility.push([webview, visible]),
	};
	return host;
}

function makeTab(host: FakeHost): GitOctopusTab {
	return new GitOctopusTab(
		host as unknown as ConstructorParameters<typeof GitOctopusTab>[0],
		Uri.file('/ext') as unknown as vscode.Uri
	);
}

const asPanel = (panel: StubWebviewPanel): vscode.WebviewPanel =>
	panel as unknown as vscode.WebviewPanel;

beforeEach(resetRecorded);

describe('pickGraphLocation', () => {
	it('brings an open tab forward whatever the setting says', () => {
		expect(pickGraphLocation(true, 'panel')).toBe('editor');
		expect(pickGraphLocation(true, undefined)).toBe('editor');
	});

	it('follows the setting while no tab is open', () => {
		expect(pickGraphLocation(false, 'editor')).toBe('editor');
		expect(pickGraphLocation(false, 'panel')).toBe('panel');
	});

	it('falls back to the Panel for a missing or unknown value', () => {
		expect(pickGraphLocation(false, undefined)).toBe('panel');
		expect(pickGraphLocation(false, 'sidebar')).toBe('panel');
	});
});

describe('GitOctopusTab', () => {
	it('opens one tab, and brings that same tab forward when asked again', async () => {
		const host = fakeHost();
		const tab = makeTab(host);

		await tab.open();
		await tab.open();

		expect(recorded.listPanels).toHaveLength(1);
		const [panel] = recorded.listPanels;
		expect(panel.viewType).toBe('git-octopus.tab');
		expect(panel.revealCount).toBe(1);
		expect(host.listAttached).toEqual([panel.webview]);
		expect(tab.isOpen).toBe(true);
	});

	it('gives the tab the light and dark octopus icons', async () => {
		const tab = makeTab(fakeHost());
		await tab.open();

		const icon = recorded.listPanels[0].iconPath as { light: vscode.Uri; dark: vscode.Uri };
		expect(icon.light.fsPath).toBe('/ext/media/octopus-light.svg');
		expect(icon.dark.fsPath).toBe('/ext/media/octopus-dark.svg');
	});

	it('opens a fresh tab once the user has closed the previous one', async () => {
		const tab = makeTab(fakeHost());
		await tab.open();
		recorded.listPanels[0].dispose();

		expect(tab.isOpen).toBe(false);
		await tab.open();
		expect(recorded.listPanels).toHaveLength(2);
	});

	it('closes its own tab', async () => {
		const tab = makeTab(fakeHost());
		await tab.open();
		tab.close();

		expect(recorded.listPanels[0].disposed).toBe(true);
		expect(tab.isOpen).toBe(false);
	});

	it('tells the controller whenever the tab goes on or off screen', async () => {
		const host = fakeHost();
		const tab = makeTab(host);
		await tab.open();
		const [panel] = recorded.listPanels;

		panel.setVisible(false);
		panel.setVisible(true);

		expect(host.listVisibility).toEqual([
			[panel.webview, true],
			[panel.webview, false],
			[panel.webview, true],
		]);
	});

	it('takes back the tab VS Code restores after a reload, behind another tab or not', async () => {
		const host = fakeHost();
		const tab = makeTab(host);
		const restored = makeWebviewPanel('git-octopus.tab', 'Git Octopus');
		restored.visible = false;

		await tab.deserializeWebviewPanel(asPanel(restored));

		expect(tab.isOpen).toBe(true);
		expect(host.listAttached).toEqual([restored.webview]);
		expect(host.listVisibility).toEqual([[restored.webview, false]]);
		await tab.open();
		expect(restored.revealCount).toBe(1);
		expect(recorded.listPanels).toHaveLength(0);
	});

	it('closes a second restored tab instead of leaving it blank', async () => {
		const host = fakeHost();
		const tab = makeTab(host);
		const first = makeWebviewPanel('git-octopus.tab', 'Git Octopus');
		const second = makeWebviewPanel('git-octopus.tab', 'Git Octopus');

		await tab.deserializeWebviewPanel(asPanel(first));
		await tab.deserializeWebviewPanel(asPanel(second));

		expect(second.disposed).toBe(true);
		expect(first.disposed).toBe(false);
		expect(host.listAttached).toEqual([first.webview]);
		expect(tab.isOpen).toBe(true);
	});
});
