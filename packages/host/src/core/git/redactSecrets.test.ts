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

	it('leaves ordinary messages alone', () => {
		const message = "fatal: pathspec 'x' did not match any files";
		expect(redactSecrets(message)).toBe(message);
	});
});
