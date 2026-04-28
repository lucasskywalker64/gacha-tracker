<script lang="ts">
	interface Props {
		title: string;
		subtitle?: string;
		children?: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
	}

	let { title, subtitle, children, footer }: Props = $props();
</script>

<div
	class="bg-zinc-900/40 border border-zinc-800 rounded-2xl overflow-hidden backdrop-blur-sm shadow-2xl"
>
	<div class="p-8 md:p-10">
		<div class="mb-8">
			<h2 class="text-2xl font-bold text-zinc-100 mb-2">{title}</h2>
			{#if subtitle}
				<p class="text-zinc-400 leading-relaxed">{subtitle}</p>
			{/if}
		</div>

		<div class="space-y-6">
			{@render children?.()}
		</div>
	</div>

	{#if footer}
		<div
			class="px-8 py-6 bg-zinc-900/80 border-t border-zinc-800 flex items-center justify-between"
		>
			{@render footer()}
		</div>
	{/if}
</div>
