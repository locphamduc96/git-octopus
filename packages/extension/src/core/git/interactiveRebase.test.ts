import { describe, expect, it } from 'vitest';
import {
	buildTodo,
	parseRebaseTodoLog,
	printfFormat,
	shellQuote,
	validateSteps,
} from './interactiveRebase';

describe('shellQuote and printfFormat', () => {
	it('keeps a single quote inside one sh argument', () => {
		expect(shellQuote("it's")).toBe(`'it'\\''s'`);
	});

	it('escapes what printf would interpret, and puts the message on one line', () => {
		expect(printfFormat('50% done\\ok\nbody')).toBe('50%% done\\\\ok\\nbody');
	});

	it('hides a leading dash from printf option parsing', () => {
		expect(printfFormat('-v flag')).toBe('\\055v flag');
	});
});

describe('validateSteps', () => {
	it('refuses squashing the first commit kept, dropping everything, and an empty reword', () => {
		expect(
			validateSteps([
				{ hash: 'a', action: 'drop' },
				{ hash: 'b', action: 'squash' },
			])
		).toMatch(/first commit kept/);
		expect(validateSteps([{ hash: 'a', action: 'drop' }])).toMatch(/Every commit is dropped/);
		expect(validateSteps([{ hash: 'a', action: 'reword', message: '  ' }])).toMatch(
			/needs a message/
		);
		expect(
			validateSteps([
				{ hash: 'a', action: 'pick' },
				{ hash: 'b', action: 'fixup' },
			])
		).toBeNull();
	});
});

describe('buildTodo', () => {
	it('writes one line per step in order, a reword as pick plus an amend from printf', () => {
		const todo = buildTodo([
			{ hash: 'b', action: 'pick' },
			{ hash: 'a', action: 'reword', message: "fix: it's done\n" },
			{ hash: 'c', action: 'squash' },
			{ hash: 'd', action: 'drop' },
		]);
		expect(todo.split('\n')).toEqual([
			'pick b',
			'pick a',
			`exec printf 'fix: it'\\''s done' | git commit --amend --only --allow-empty --no-verify -F -`,
			'squash c',
			'drop d',
			'',
		]);
	});
});

describe('parseRebaseTodoLog', () => {
	it('reads hash, author and the full message, oldest first as git gave them', () => {
		const output = '\x1eaaa\x1fAda\x1ffeat: one\n\nbody\n\n\x1ebbb\x1fGrace\x1ffix: two\n';
		expect(parseRebaseTodoLog(output)).toEqual([
			{ hash: 'aaa', author: 'Ada', message: 'feat: one\n\nbody', subject: 'feat: one' },
			{ hash: 'bbb', author: 'Grace', message: 'fix: two', subject: 'fix: two' },
		]);
	});
});
