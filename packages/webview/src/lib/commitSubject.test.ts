import { describe, expect, it } from 'vitest';
import { formatSubject, parseSubject } from './commitSubject.js';

describe('parseSubject', () => {
	it('splits a leading ticket reference off the subject', () => {
		expect(parseSubject('[ZG-2192] Update config hostdomain db')).toEqual({
			ticket: 'ZG-2192',
			type: null,
			scope: null,
			text: 'Update config hostdomain db',
		});
	});

	it('leaves a subject without a reference or type alone', () => {
		expect(parseSubject('Update config')).toEqual({
			ticket: null,
			type: null,
			scope: null,
			text: 'Update config',
		});
	});

	it('only takes a reference at the start', () => {
		expect(parseSubject('Update config for [ZG-1]').ticket).toBeNull();
	});

	it('recognises a reference even when nothing follows it yet', () => {
		expect(parseSubject('[ZG-2192]')).toEqual({
			ticket: 'ZG-2192',
			type: null,
			scope: null,
			text: '',
		});
	});

	it('recognises a type even when nothing follows it yet', () => {
		expect(parseSubject('feat:')).toEqual({ ticket: null, type: 'feat', scope: null, text: '' });
	});

	it('accepts several references in one label', () => {
		expect(parseSubject('[ZG-1, ZG-2] Fix both').ticket).toBe('ZG-1, ZG-2');
	});

	it('reads a conventional-commit type', () => {
		expect(parseSubject('feat: add week selector')).toEqual({
			ticket: null,
			type: 'feat',
			scope: null,
			text: 'add week selector',
		});
	});

	it('reads a type with a scope', () => {
		expect(parseSubject('feat(leaderboard): open the week selector')).toEqual({
			ticket: null,
			type: 'feat',
			scope: 'leaderboard',
			text: 'open the week selector',
		});
	});

	it('reads a ticket and a type together', () => {
		expect(parseSubject('[ZG-2447] fix: stop the timer leaking')).toEqual({
			ticket: 'ZG-2447',
			type: 'fix',
			scope: null,
			text: 'stop the timer leaking',
		});
	});

	it('does not treat an ordinary word before a colon as a type', () => {
		const parsed = parseSubject('Update config: new values');
		expect(parsed.type).toBeNull();
		expect(parsed.text).toBe('Update config: new values');
	});

	it('leaves merge subjects untouched', () => {
		const subject = "Merge branch 'dev' into 'master'";
		expect(parseSubject(subject)).toEqual({
			ticket: null,
			type: null,
			scope: null,
			text: subject,
		});
	});
});

describe('formatSubject', () => {
	it('puts the type after the ticket', () => {
		expect(formatSubject({ ticket: 'ZG-1', type: 'feat', scope: null, text: 'add thing' })).toBe(
			'[ZG-1] feat: add thing'
		);
	});

	it('keeps the scope with the type', () => {
		expect(formatSubject({ ticket: null, type: 'fix', scope: 'auth', text: 'refresh token' })).toBe(
			'fix(auth): refresh token'
		);
	});

	it('returns the plain text when there is no prefix', () => {
		expect(formatSubject({ ticket: null, type: null, scope: null, text: 'just this' })).toBe(
			'just this'
		);
	});

	it('round-trips whatever parseSubject produced', () => {
		const subject = '[ZG-2447] feat(leaderboard): open the week selector';
		expect(formatSubject(parseSubject(subject))).toBe(subject);
	});

	/** Mirrors picking a type in the commit dialog: parse what is typed, set the type, rebuild. */
	function applyType(summary: string, type: string | null): string {
		const parsed = parseSubject(summary);
		return formatSubject({ ...parsed, type: parsed.type === type ? null : type });
	}

	it('puts the type after a ticket that was typed on its own', () => {
		expect(applyType('[ZG-2445]', 'feat')).toBe('[ZG-2445] feat:');
	});

	it('puts the type after a ticket that already has a message', () => {
		expect(applyType('[ZG-2445] add the thing', 'feat')).toBe('[ZG-2445] feat: add the thing');
	});

	it('swaps one type for another', () => {
		expect(applyType('[ZG-1] feat: add', 'fix')).toBe('[ZG-1] fix: add');
	});

	it('removes the type when the same one is picked again', () => {
		expect(applyType('[ZG-1] feat: add', 'feat')).toBe('[ZG-1] add');
	});

	it('adds a type to a bare message', () => {
		expect(applyType('add the thing', 'chore')).toBe('chore: add the thing');
	});
});
