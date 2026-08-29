/**
 * Where list navigation lands next. ↑/↓ step by one, PageUp/PageDown by `pageJump`, Home/End
 * jump to the edges — all clamped to [0, last]. `current` is -1 while nothing is selected, and
 * every key then starts from the top rather than nowhere.
 */
export function nextRowIndex(key: string, current: number, last: number, pageJump: number): number {
	switch (key) {
		case 'ArrowUp':
			return current <= 0 ? 0 : current - 1;
		case 'ArrowDown':
			return current === -1 ? 0 : Math.min(last, current + 1);
		case 'PageUp':
			return Math.max(0, (current === -1 ? 0 : current) - pageJump);
		case 'PageDown':
			return Math.min(last, (current === -1 ? 0 : current) + pageJump);
		case 'Home':
			return 0;
		// `key` is a raw DOM string, not a closed union, so End cannot be a case with an exhaustive
		// arm behind it — every key the caller routes here that is not listed above means End.
		default:
			return last;
	}
}
