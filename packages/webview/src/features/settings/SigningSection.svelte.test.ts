import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { SigningMessage } from '@git-octopus/shared';

const listSent: { type: string; [key: string]: unknown }[] = [];
vi.stubGlobal('acquireVsCodeApi', () => ({
	postMessage: (message: { type: string }) => listSent.push(message),
	getState: () => undefined,
	setState: () => undefined,
}));

const { dispatchHostMessage } = await import('../../lib/hostRouter');
const { default: SigningSection } = await import('./SigningSection.svelte');

const GLOBAL = { scope: 'global', origin: '/Users/me/.gitconfig' };

function signing(extra: Partial<SigningMessage> = {}): SigningMessage {
	return {
		type: 'signing',
		repoPath: '',
		mapValues: {},
		listLocalKeys: [],
		gitVersion: '2.54.0',
		...extra,
	};
}

describe('SigningSection', () => {
	it('writes the toggle and the format to the repository, one key at a time', async () => {
		listSent.length = 0;
		render(SigningSection, { showSignatures: false, onshowSignatures: () => {} });
		dispatchHostMessage(signing());
		const toggle = (await screen.findByLabelText(
			'Sign commits in this repository'
		)) as HTMLInputElement;
		expect(toggle.checked).toBe(false);
		await fireEvent.click(toggle);
		expect(listSent.at(-1)).toEqual({
			type: 'signingAction',
			repoPath: '',
			mapValues: { 'commit.gpgsign': 'true' },
		});

		dispatchHostMessage(signing());
		await fireEvent.change(screen.getByLabelText('Signing format'), {
			target: { value: 'ssh' },
		});
		expect(listSent.at(-1)).toMatchObject({ mapValues: { 'gpg.format': 'ssh' } });
	});

	it('says where each value comes from, and reads a bare key as on', async () => {
		render(SigningSection, { showSignatures: false, onshowSignatures: () => {} });
		dispatchHostMessage(
			signing({ mapValues: { 'commit.gpgsign': { value: '', bare: true, ...GLOBAL } } })
		);
		const toggle = (await screen.findByLabelText(
			'Sign commits in this repository'
		)) as HTMLInputElement;
		expect(toggle.checked).toBe(true);
		expect(
			screen.getByText(/commit.gpgSign — inherited from \/Users\/me\/.gitconfig/)
		).toBeTruthy();
	});

	it('names a broken gpg.format and the file it is in', async () => {
		render(SigningSection, { showSignatures: false, onshowSignatures: () => {} });
		dispatchHostMessage(
			signing({
				mapValues: {
					'gpg.format': { value: '', ...GLOBAL },
					'gpg.ssh.program': { value: '', ...GLOBAL },
				},
			})
		);
		const listAlerts = await screen.findAllByRole('alert');
		expect(listAlerts.map((alert) => alert.textContent)).toEqual([
			expect.stringMatching(/gpg.format is “” in \/Users\/me\/.gitconfig/),
		]);
	});

	it('saves the key only once it changed, and an emptied key unsets it', async () => {
		listSent.length = 0;
		render(SigningSection, { showSignatures: false, onshowSignatures: () => {} });
		dispatchHostMessage(
			signing({
				mapValues: {
					'gpg.format': { value: 'ssh', scope: 'local', origin: '.git/config' },
					'user.signingkey': { value: '~/.ssh/a.pub', scope: 'local', origin: '.git/config' },
				},
				listLocalKeys: ['gpg.format', 'user.signingkey'],
			})
		);
		const input = (await screen.findByLabelText('Signing key')) as HTMLInputElement;
		expect(input.value).toBe('~/.ssh/a.pub');
		const listSave = screen.getAllByText('Save') as HTMLButtonElement[];
		expect(listSave[0].disabled).toBe(true);
		await fireEvent.input(input, { target: { value: '  ' } });
		await fireEvent.click(listSave[0]);
		expect(listSent.at(-1)).toMatchObject({ mapValues: { 'user.signingkey': null } });

		// SSH without a signers file: the badge would never appear, and the tab says why.
		expect(screen.getByText(/allowed signers file git cannot check/)).toBeTruthy();

		await fireEvent.click(screen.getByText(/Remove this repository's signing settings/));
		expect(listSent.at(-1)).toMatchObject({
			mapValues: { 'gpg.format': null, 'user.signingkey': null },
		});
	});

	it('turns the graph badges on through the view setting', async () => {
		const onshowSignatures = vi.fn();
		render(SigningSection, { showSignatures: false, onshowSignatures });
		await fireEvent.click(screen.getByLabelText('Show signatures on the graph'));
		expect(onshowSignatures).toHaveBeenCalledWith(true);
	});
});
