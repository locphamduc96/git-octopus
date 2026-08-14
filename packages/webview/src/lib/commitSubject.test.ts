import { describe, expect, it } from 'vitest';
import { parseSubject } from './commitSubject.js';

describe('parseSubject', () => {
	it('splits a leading ticket reference off the subject', () => {
		expect(parseSubject('[ZG-2192] Update config hostdomain db')).toEqual({
			ticket: 'ZG-2192',
			text: 'Update config hostdomain db',
		});
	});

	it('leaves a subject without a reference alone', () => {
		expect(parseSubject('Update config')).toEqual({ ticket: null, text: 'Update config' });
	});

	it('only takes a reference at the start', () => {
		const subject = 'Update config for [ZG-1]';
		expect(parseSubject(subject)).toEqual({ ticket: null, text: subject });
	});

	it('keeps the subject intact when the label is all there is', () => {
		expect(parseSubject('[ZG-2192]')).toEqual({ ticket: null, text: '[ZG-2192]' });
	});

	it('ignores an empty label', () => {
		expect(parseSubject('[] Update')).toEqual({ ticket: null, text: '[] Update' });
	});

	it('accepts several references in one label', () => {
		expect(parseSubject('[ZG-1, ZG-2] Fix both')).toEqual({
			ticket: 'ZG-1, ZG-2',
			text: 'Fix both',
		});
	});
});
