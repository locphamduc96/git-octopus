import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import LfsCard from './LfsCard.svelte';

describe('LfsCard', () => {
	it('names the object each side points at, and says when a side has none', () => {
		render(LfsCard, { lfs: { after: { oid: 'b'.repeat(64), size: 2621440 } } });
		expect(screen.getByText('2.5 MB')).toBeTruthy();
		expect(screen.getByText(`oid ${'b'.repeat(12)}`)).toBeTruthy();
		expect(screen.getByText('not an LFS object here')).toBeTruthy();
	});
});
