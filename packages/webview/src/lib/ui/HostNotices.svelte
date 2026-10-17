<script lang="ts">
	import { hostNotices } from '../stores/hostNotices.svelte';
	import Icon from './Icon.svelte';
	import IconButton from './IconButton.svelte';

	const mapIcon = { info: 'info', warning: 'warning', error: 'error' } as const;

	/** Every host message is written for a notification shared with other extensions; here it is ours. */
	const plain = (message: string): string => message.replace(/^Git Octopus: /, '');
</script>

{#if hostNotices.list.length > 0 || hostNotices.tasks.length > 0}
	<div class="stack" aria-live="polite">
		{#each hostNotices.tasks as task (task.id)}
			<div class="toast task" role="status">
				<span class="lead spin"><Icon name="loading" /></span>
				<span class="text">
					<span class="title">{plain(task.title)}</span>
					{#if task.message}<span class="detail">{task.message}</span>{/if}
				</span>
				{#if task.cancellable}
					<button class="action" onclick={() => hostNotices.cancel(task.id)}>Cancel</button>
				{/if}
			</div>
		{/each}
		{#each hostNotices.list as notice (notice.id)}
			<div class="toast {notice.level}" role={notice.level === 'info' ? 'status' : 'alert'}>
				<span class="lead"><Icon name={mapIcon[notice.level]} /></span>
				<span class="text">{plain(notice.message)}</span>
				{#each notice.listActions as action (action)}
					<button class="action" onclick={() => hostNotices.answer(notice.id, action)}>
						{action}
					</button>
				{/each}
				<IconButton name="close" label="Dismiss" onclick={() => hostNotices.answer(notice.id)} />
			</div>
		{/each}
	</div>
{/if}

<style>
	.stack {
		position: fixed;
		right: var(--gg-space-3);
		bottom: var(--gg-space-3);
		z-index: 60;
		display: flex;
		flex-direction: column;
		gap: var(--gg-space-2);
		width: min(420px, calc(100vw - 2 * var(--gg-space-3)));
	}
	.toast {
		display: flex;
		align-items: center;
		gap: var(--gg-space-2);
		padding: var(--gg-space-2) var(--gg-space-3);
		background: var(--gg-bg-overlay);
		border: 1px solid var(--gg-border);
		border-radius: var(--gg-radius-lg);
		box-shadow: var(--gg-shadow);
	}
	.lead {
		display: inline-flex;
		flex: none;
	}
	.info .lead {
		color: var(--gg-accent);
	}
	.warning .lead {
		color: var(--gg-warning);
	}
	.error .lead {
		color: var(--gg-danger);
	}
	.spin {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.title {
		font-weight: 600;
	}
	.detail {
		color: var(--gg-fg-muted);
		font-size: var(--gg-text-sm);
	}
	.action {
		flex: none;
		display: inline-flex;
		align-items: center;
		height: var(--gg-hit);
		padding: 0 var(--gg-space-2);
		font: inherit;
		color: var(--gg-btn-fg);
		background: var(--gg-btn-bg);
		border: none;
		border-radius: var(--gg-radius);
		cursor: pointer;
	}
	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
		}
	}
</style>
