import { describe, expect, it } from 'vitest';
import { gravatarUrl } from './gravatar.js';

describe('gravatarUrl', () => {
	it('hashes the lowercased, trimmed address', () => {
		// Gravatar's documented example hash for this address.
		expect(gravatarUrl('  MyEmailAddress@example.com ')).toContain(
			'0bc83cb571cd1c50ba6f3e8a78ef1346'
		);
	});

	it('requests the given size and a generated fallback image', () => {
		const url = gravatarUrl('a@b.co', 64);
		expect(url).toContain('s=64');
		expect(url).toContain('d=retro');
	});
});
