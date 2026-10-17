import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('acquireVsCodeApi', () => ({
	postMessage: () => {},
	getState: () => undefined,
	setState: () => undefined,
}));

const { default: ControlBar } = await import('./ControlBar.svelte');

function mount(over: { ahead?: number; behind?: number; identityWarning?: string | null } = {}) {
	render(ControlBar, {
		repos: [],
		activeRepo: null,
		repoName: 'rhythm-game',
		listBranches: [],
		currentBranch: 'main',
		loading: false,
		notice: null,
		listSolo: [],
		hiddenCount: 0,
		onshowHidden: vi.fn(),
		onclearFilter: vi.fn(),
		onjumpBranch: vi.fn(),
		commitCount: 15,
		ahead: over.ahead ?? 0,
		behind: over.behind ?? 0,
		undoLabel: null,
		onundo: vi.fn(),
		repoState: null,
		onselectRepo: vi.fn(),
		onrefresh: vi.fn(),
		onterminal: vi.fn(),
		onfind: vi.fn(),
		onfetch: vi.fn(),
		onpull: vi.fn(),
		onpullOption: vi.fn(),
		onpush: vi.fn(),
		onpushForce: vi.fn(),
		onsequencer: vi.fn(),
		previousBranch: null,
		headHash: null,
		onbackToPreviousBranch: vi.fn(),
		onbranchFromHead: vi.fn(),
		onshowHead: vi.fn(),
		onsettings: vi.fn(),
		oncleanup: vi.fn(),
		identityLabel: 'Loc Pham',
		identityInitials: 'LP',
		identityLine: 'Loc Pham <loc@example.com>',
		identityWarning: over.identityWarning ?? null,
		listIdentities: [],
		activeEmail: 'loc@example.com',
		globalIdentity: null,
		overridden: false,
		onuseGlobal: vi.fn(),
		suggestedIdentity: null,
		onapplyIdentity: vi.fn(),
		onaddIdentity: vi.fn(),
		onidentity: vi.fn(),
	});
}

describe('ControlBar identity', () => {
	it('shows initials and a name, with the full identity on the button for screen readers', () => {
		mount();
		const button = screen.getByRole('button', { name: 'Git identity: Loc Pham <loc@example.com>' });
		expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('LP Loc Pham');
	});

	it('keeps the warning state when the remote suggests another identity', () => {
		mount({ identityWarning: 'Use Work' });
		expect(
			screen.getByRole('button', { name: /^Git identity/ }).classList.contains('warning')
		).toBe(true);
	});
});

describe('ControlBar drift counts', () => {
	it('writes the ahead and behind counts beside the arrows, as plain accent numbers', () => {
		mount({ ahead: 2, behind: 3 });
		const listCounts = [...document.querySelectorAll('.drift')].map((count) => count.textContent);
		expect(listCounts).toEqual(['3', '2']);
	});

	it('writes no count when the branch is level', () => {
		mount();
		expect(document.querySelectorAll('.drift')).toHaveLength(0);
	});
});

describe('ControlBar groups', () => {
	it('puts every button on one of three islands, with no rule between them', () => {
		mount();
		const listIslands = [...document.querySelectorAll('.actions > .gg-island')];
		const islandOf = (name: RegExp) => screen.getByRole('button', { name }).closest('.gg-island');
		expect(listIslands).toHaveLength(3);
		for (const name of [/^Fetch/, /^Pull/, /^Push/, /^Refresh/, /^Undo/, /^Redo/]) {
			expect(islandOf(name)).toBe(listIslands[0]);
		}
		expect(islandOf(/^Git identity/)).toBe(listIslands[1]);
		for (const name of [/^Find commits/, /^Clean up branches/, /^Open terminal/, /^Settings/]) {
			expect(islandOf(name)).toBe(listIslands[2]);
		}
		expect(document.querySelector('.divider')).toBeNull();
	});
});
