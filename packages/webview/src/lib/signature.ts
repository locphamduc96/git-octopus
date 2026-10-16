import type {
	SignatureStatus,
	SigningConfigValue,
	SigningKey,
	SigningMessage,
} from '@git-octopus/shared';

export interface SignatureLook {
	icon: string;
	tone: 'good' | 'warn' | 'bad';
	label: string;
}

export const MAP_SIGNATURE_LOOK: Record<SignatureStatus, SignatureLook> = {
	good: { icon: 'verified-filled', tone: 'good', label: 'Good signature' },
	untrusted: {
		icon: 'verified',
		tone: 'warn',
		label:
			'Good signature from a key that is not trusted — for SSH, one missing from the allowed signers file',
	},
	bad: { icon: 'unverified', tone: 'bad', label: 'Bad signature — the commit does not match it' },
	expired: { icon: 'unverified', tone: 'warn', label: 'Good signature, but it has expired' },
	expiredKey: {
		icon: 'unverified',
		tone: 'warn',
		label: 'Good signature from a key that has since expired',
	},
	revoked: { icon: 'unverified', tone: 'bad', label: 'Signed with a key that has been revoked' },
	missingKey: {
		icon: 'workspace-untrusted',
		tone: 'warn',
		label: 'Signed, but the signature cannot be checked — the key is not available here',
	},
};

export type SigningFormat = 'openpgp' | 'ssh' | 'x509';
export const LIST_SIGNING_FORMATS: SigningFormat[] = ['openpgp', 'ssh', 'x509'];

/** How git reads a boolean: a bare key is true, an empty value false, and anything else unknown. */
export function gitBool(entry: SigningConfigValue | undefined): boolean | null {
	if (!entry) return null;
	if (entry.bare) return true;
	const value = entry.value.trim().toLowerCase();
	if (['true', 'yes', 'on', '1'].includes(value)) return true;
	if (['false', 'no', 'off', '0', ''].includes(value)) return false;
	return /^-?\d+$/.test(value) ? Number(value) !== 0 : null;
}

/** The format git signs with — openpgp unless set; null when the value is one git rejects. */
export function effectiveFormat(state: Pick<SigningMessage, 'mapValues'>): SigningFormat | null {
	const entry = state.mapValues['gpg.format'];
	if (!entry) return 'openpgp';
	return LIST_SIGNING_FORMATS.find((format) => format === entry.value) ?? null;
}

/** "2.33.1" is before 2.34. */
export function versionBefore(version: string | null, major: number, minor: number): boolean {
	if (!version) return false;
	const [actualMajor = 0, actualMinor = 0] = version.split('.').map(Number);
	return actualMajor < major || (actualMajor === major && actualMinor < minor);
}

/** Where a value comes from, in words: this repository, the global file, or the system one. */
export function originLabel(entry: SigningConfigValue | undefined): string {
	if (!entry) return 'not set';
	if (entry.scope === 'local' || entry.scope === 'worktree') return 'set in this repository';
	if (entry.scope === 'global') return `inherited from ${entry.origin || 'the global config'}`;
	return `inherited from ${entry.scope} config${entry.origin ? ` (${entry.origin})` : ''}`;
}

function at(entry: SigningConfigValue): string {
	return entry.origin ? ` in ${entry.origin}` : '';
}

/**
 * What stops signing — or checking signatures — from working with the config as it stands. These
 * are the failures git reports badly: a bad `gpg.format` is fatal to every command that reads it,
 * in every repository, and a repository value cannot shadow it.
 */
export function signingProblems(state: SigningMessage): string[] {
	const listProblems: string[] = [];
	const map = state.mapValues;
	const format = map['gpg.format'];
	if (format && effectiveFormat(state) === null) {
		listProblems.push(
			`gpg.format is “${format.value}”${at(format)}. Git refuses to sign or verify anything — in any repository — until that line is fixed (openpgp, ssh or x509) or removed.`
		);
	}
	const resolved = effectiveFormat(state);
	const programKey: SigningKey | null =
		resolved === 'ssh' ? 'gpg.ssh.program' : resolved === 'openpgp' ? 'gpg.program' : null;
	const program = programKey ? map[programKey] : undefined;
	if (programKey && program && !program.bare && program.value.trim() === '') {
		listProblems.push(
			`${programKey} is empty${at(program)}. Git tries to run a program with no name and signing fails — remove the line to use the default.`
		);
	}
	if (resolved === 'ssh') {
		if (versionBefore(state.gitVersion, 2, 34)) {
			listProblems.push(`SSH signing needs git 2.34 or later; this is git ${state.gitVersion}.`);
		}
		const signers = map['gpg.ssh.allowedsignersfile'];
		if (!signers || signers.value.trim() === '') {
			listProblems.push(
				'Without an allowed signers file git cannot check SSH signatures: signed commits get no badge.'
			);
		}
		const key = map['user.signingkey'];
		if (gitBool(map['commit.gpgsign']) && (!key || key.value.trim() === '')) {
			listProblems.push(
				'SSH signing needs a signing key — a public key file, or key:: followed by the key.'
			);
		}
	}
	return listProblems;
}
