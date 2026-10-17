import { describe, expect, it } from 'vitest';
import { readHostViewSettings } from './CommitActionService.js';

describe('readHostViewSettings', () => {
	it('reads the settings out of the shape the view actually persists', () => {
		// The whole preferences object, exactly as `savePreferences` writes it.
		const stored = {
			settings: { autoFastForwardOnCheckout: false },
			columns: { author: false, commit: false, date: true },
			fileView: 'tree',
			metaOpen: false,
		};
		expect(readHostViewSettings(stored)).toEqual({ autoFastForwardOnCheckout: false });
	});

	it('carries the chosen terminal app through', () => {
		expect(readHostViewSettings({ settings: { terminalApp: 'Ghostty' } })).toEqual({
			terminalApp: 'Ghostty',
		});
	});

	it('answers null for a blob with nothing saved in it yet', () => {
		expect(readHostViewSettings(null)).toBeNull();
		expect(readHostViewSettings({})).toBeNull();
		expect(readHostViewSettings('nonsense')).toBeNull();
	});
});
