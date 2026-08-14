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

	it('keeps the subject intact when the label is all there is', () => {
		expect(parseSubject('[ZG-2192]').text).toBe('[ZG-2192]');
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
		expect(
			formatSubject({ ticket: 'ZG-1', type: 'feat', scope: null, text: 'add thing' })
		).toBe('[ZG-1] feat: add thing');
	});

	it('keeps the scope with the type', () => {
		expect(
			formatSubject({ ticket: null, type: 'fix', scope: 'auth', text: 'refresh token' })
		).toBe('fix(auth): refresh token');
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
});
