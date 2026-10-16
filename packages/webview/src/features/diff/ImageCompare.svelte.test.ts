import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ImageCompare from './ImageCompare.svelte';

const RED = { dataUri: 'data:image/png;base64,UkVE', bytes: 2048 };
const BLUE = { dataUri: 'data:image/png;base64,QkxVRQ==', bytes: 512 };

describe('ImageCompare', () => {
	it('shows the old and the new image side by side, with their sizes', () => {
		render(ImageCompare, { image: { before: RED, after: BLUE } });
		expect(screen.getByAltText('Before').getAttribute('src')).toBe(RED.dataUri);
		expect(screen.getByAltText('After').getAttribute('src')).toBe(BLUE.dataUri);
		expect(screen.getByText(/2\.0 KB/)).toBeTruthy();
		expect(screen.getByText(/512 B/)).toBeTruthy();
	});

	it('lays the new image over the old one with a slider', async () => {
		render(ImageCompare, { image: { before: RED, after: BLUE } });
		await fireEvent.click(screen.getByRole('radio', { name: 'Overlay' }));
		const slider = screen.getByLabelText('Show the new image over the old') as HTMLInputElement;
		await fireEvent.input(slider, { target: { value: '20' } });
		expect((screen.getByAltText('After') as HTMLImageElement).style.opacity).toBe('0.2');
	});

	it('says which side is missing for an added image, and offers no overlay', () => {
		render(ImageCompare, { image: { after: BLUE } });
		expect(screen.getByText('Not there before this change')).toBeTruthy();
		expect(screen.queryByRole('radio', { name: 'Overlay' })).toBeNull();
	});
});
