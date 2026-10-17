import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redactSecrets';

const SENTINEL = 'sentinel-secret-9f2c';

describe('redactSecrets', () => {
	it('strips userinfo from https URLs in git errors', () => {
		const raw = `fatal: unable to access 'https://user:${SENTINEL}@zalogit2.zing.vn/team/repo.git/'`;
		const clean = redactSecrets(raw);
		expect(clean).not.toContain(SENTINEL);
		expect(clean).toContain('https://***@zalogit2.zing.vn');
	});

	it('strips token-as-username userinfo', () => {
		expect(redactSecrets(`https://${SENTINEL}@github.com/o/r.git`)).not.toContain(SENTINEL);
	});

	it('strips authorization-style values', () => {
		expect(redactSecrets(`request had Authorization: Basic ${SENTINEL}`)).not.toContain(SENTINEL);
	});

	it('scrubs exact extra values wherever they appear', () => {
		const clean = redactSecrets(`stack: at ${SENTINEL} in /tmp/gg-ask-x/s`, [
			SENTINEL,
			'/tmp/gg-ask-x/s',
		]);
		expect(clean).not.toContain(SENTINEL);
		expect(clean).not.toContain('gg-ask-x');
	});

	it('strips userinfo from http URLs', () => {
		const clean = redactSecrets(`fatal: unable to access 'http://user:${SENTINEL}@host.local/r.git'`);
		expect(clean).not.toContain(SENTINEL);
		expect(clean).toContain('http://***@host.local');
	});

	it('strips userinfo behind an upper-case scheme', () => {
		const clean = redactSecrets(`HTTPS://user:${SENTINEL}@host.local/r.git`);
		expect(clean).not.toContain(SENTINEL);
		expect(clean).toContain('@host.local');
	});

	it('replaces extra values with regex characters literally and keeps the surrounding text', () => {
		const clean = redactSecrets('before a.b*c+? after axbbbc', ['a.b*c+?']);
		expect(clean).toBe('before *** after axbbbc');
	});

	it('ignores an empty string in the extra list', () => {
		const message = 'nothing to scrub here';
		expect(redactSecrets(message, [''])).toBe(message);
	});

	it('strips userinfo from every URL in one message', () => {
		const clean = redactSecrets(
			`from https://a:${SENTINEL}@one.example/r.git to http://${SENTINEL}2@two.example/r.git`,
		);
		expect(clean).not.toContain(SENTINEL);
		expect(clean).toContain('https://***@one.example');
		expect(clean).toContain('http://***@two.example');
	});

	it('leaves ordinary messages alone', () => {
		const message = "fatal: pathspec 'x' did not match any files";
		expect(redactSecrets(message)).toBe(message);
	});
});
