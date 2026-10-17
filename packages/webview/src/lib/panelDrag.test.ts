import { describe, expect, it } from 'vitest';
import { dragForRepo, type PanelDrag } from './panelDrag';

const drag: PanelDrag = { ref: 'main', label: 'main', local: true, repoPath: '/a' };

describe('dragForRepo', () => {
	it('keeps a drag started in the active repository', () => {
		expect(dragForRepo(drag, '/a')).toBe(drag);
	});

	it('drops a drag from another repository', () => {
		expect(dragForRepo(drag, '/b')).toBeNull();
	});

	it('passes no drag through', () => {
		expect(dragForRepo(null, '/a')).toBeNull();
	});
});
