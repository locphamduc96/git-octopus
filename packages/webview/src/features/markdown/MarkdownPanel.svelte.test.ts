import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MarkdownPanel from './MarkdownPanel.svelte';

function mount(content: string) {
	const callbacks = { oncopy: vi.fn(), onsave: vi.fn(), onopenlink: vi.fn() };
	const result = render(MarkdownPanel, { title: 'AI Explain', content, ...callbacks });
	return { ...callbacks, ...result };
}

describe('MarkdownPanel rendering', () => {
	it('renders the title, a heading, a list and a fenced code block', () => {
		const { container } = mount(
			['# Summary', '', '- one', '- two', '', '```ts', 'const answer = 42;', '```'].join('\n')
		);
		expect(screen.getByRole('heading', { level: 2, name: 'AI Explain' })).toBeTruthy();
		expect(container.querySelector('.body h1')?.textContent).toBe('Summary');
		const listItems = [...container.querySelectorAll('.body li')].map((item) => item.textContent);
		expect(listItems).toEqual(['one', 'two']);
		expect(container.querySelector('.body pre code')?.textContent).toContain('const answer = 42;');
	});

	it('shows a script tag as text and creates no script element', () => {
		const { container } = mount(
			'before <script>alert(1)</script> after\n\n<img src=x onerror=alert(1)>'
		);
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('.body')?.textContent).toContain('<script>alert(1)</script>');
	});

	it('shows an image as its alt text without fetching it', () => {
		const { container } = mount('![diagram](https://example.com/a.png)');
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('.body')?.textContent).toContain('diagram');
	});
});

describe('MarkdownPanel links', () => {
	it('does not make a javascript: link clickable', async () => {
		const { container, onopenlink } = mount('[run](javascript:alert(1))');
		expect(container.querySelector('a')).toBeNull();
		await fireEvent.click(screen.getByText(/run/));
		expect(onopenlink).not.toHaveBeenCalled();
	});

	it.each([
		['data:', '[x](data:text/html,hi)'],
		['file:', '[x](file:///etc/passwd)'],
		['relative', '[x](../secret.md)'],
		['http:', '[x](http://example.com)'],
		['mailto:', '[x](mailto:a@example.com)'],
	])('renders a %s link as inert text', async (_name, source) => {
		const { container, onopenlink } = mount(source);
		expect(container.querySelector('a')).toBeNull();
		await fireEvent.click(container.querySelector('.body') as HTMLElement);
		expect(onopenlink).not.toHaveBeenCalled();
		expect(container.querySelector('.body')?.textContent).toContain('x');
	});

	it('sends an https: link through onopenlink and does not navigate', async () => {
		const { container, onopenlink } = mount('[docs](https://example.com/docs?a=1)');
		const anchor = container.querySelector('a') as HTMLAnchorElement;
		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		anchor.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(onopenlink).toHaveBeenCalledExactlyOnceWith('https://example.com/docs?a=1');
	});

	it('does not navigate on a middle click either', () => {
		const { container, onopenlink } = mount('[docs](https://example.com)');
		const anchor = container.querySelector('a') as HTMLAnchorElement;
		const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
		anchor.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(onopenlink).not.toHaveBeenCalled();
	});
});

describe('MarkdownPanel actions', () => {
	const content = '# Title\n\nSome **bold** text';

	it('Copy hands back the markdown source', async () => {
		const { oncopy, onsave } = mount(content);
		await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
		expect(oncopy).toHaveBeenCalledExactlyOnceWith(content);
		expect(onsave).not.toHaveBeenCalled();
	});

	it('Save as… hands back the markdown source', async () => {
		const { oncopy, onsave } = mount(content);
		await fireEvent.click(screen.getByRole('button', { name: 'Save as…' }));
		expect(onsave).toHaveBeenCalledExactlyOnceWith(content);
		expect(oncopy).not.toHaveBeenCalled();
	});
});
