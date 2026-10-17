import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { useDesktopSession, type Session } from '../../src/session.js';

// 113h: the tabs open when the app last quit come back, in their order, the same one in front.
let s: Session;
useDesktopSession((session) => (s = session), {
	reopenTabs: (root) => ({
		listOpen: [path.join(root, 'review'), path.join(root, 'review-wt')],
		activeIndex: 1,
	}),
});

test('T.6 the tabs left open come back, the same one in front', async () => {
	const strip = s.tabs;
	if (!strip) throw new Error('no tab strip');
	await expect
		.poll(() => strip.locator('.tab .name').allInnerTexts())
		.toEqual(['review', 'review-wt']);
	await expect.poll(() => strip.locator('.tab.active .name').innerText()).toBe('review-wt');
});
