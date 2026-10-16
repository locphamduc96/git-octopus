import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CommitDialog from './CommitDialog.svelte';

function mount(over: Record<string, unknown> = {}) {
	const props = {
		stagedCount: 2,
		oncommit: vi.fn(),
		oncancel: vi.fn(),
		onpushAfter: vi.fn(),
		...over,
	};
	render(CommitDialog, props);
	return props;
}

const summaryBox = () =>
	screen.getByPlaceholderText('Short description of the change') as HTMLInputElement;

describe('CommitDialog', () => {
	it('starts from the commit template: first line as summary, the rest as description', () => {
		mount({ template: '[TICKET] \n\nWhy:' });
		expect(summaryBox().value).toBe('[TICKET] ');
		expect(
			(screen.getByPlaceholderText('Why the change was made') as HTMLTextAreaElement).value
		).toBe('Why:');
	});

	it('sends the hooks and push choices with the commit', async () => {
		const props = mount({ pushAfter: true });
		await fireEvent.input(summaryBox(), { target: { value: 'feat: x' } });
		await fireEvent.click(screen.getByText(/Skip Git hooks/));
		await fireEvent.keyDown(summaryBox(), { key: 'Enter' });
		expect(props.oncommit).toHaveBeenCalledWith('feat: x', false, {
			noVerify: true,
			pushAfter: true,
		});
	});

	it('never pushes after an amend', async () => {
		const props = mount({ pushAfter: true });
		await fireEvent.click(screen.getByText(/Amend the last commit/));
		const push = screen
			.getByText(/Push after committing/)
			.querySelector('input') as HTMLInputElement;
		expect(push.disabled).toBe(true);
		await fireEvent.keyDown(summaryBox(), { key: 'Enter' });
		expect(props.oncommit).toHaveBeenCalledWith('', true, { noVerify: false, pushAfter: false });
	});

	it("starts from a refused commit's draft instead of the template", () => {
		mount({
			template: 'feat: ',
			draft: { summary: 'test chan-hook', description: 'why', amend: false, noVerify: true },
		});
		expect(summaryBox().value).toBe('test chan-hook');
		expect(
			(screen.getByPlaceholderText('Why the change was made') as HTMLTextAreaElement).value
		).toBe('why');
		const skip = screen.getByText(/Skip Git hooks/).querySelector('input') as HTMLInputElement;
		expect(skip.checked).toBe(true);
	});

	it('hands over what it commits, so a refusal can bring it back', async () => {
		const ondraft = vi.fn();
		mount({ ondraft });
		await fireEvent.input(summaryBox(), { target: { value: 'feat: x' } });
		await fireEvent.keyDown(summaryBox(), { key: 'Enter' });
		expect(ondraft).toHaveBeenCalledWith({
			summary: 'feat: x',
			description: '',
			amend: false,
			noVerify: false,
		});
	});
});
