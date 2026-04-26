<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import type { ComponentType } from 'svelte';

	interface Props {
		title: string;
		value: string | number;
		icon?: ComponentType;
		description?: string;
		trend?: {
			value: string;
			isPositive: boolean;
		};
	}

	let { title, value, icon: Icon, description, trend }: Props = $props();
</script>

<Card class="p-6 bg-zinc-900/50 border-zinc-800 backdrop-blur-sm relative overflow-hidden group">
	<div
		class="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity"
	>
		{#if Icon}
			<Icon size={80} />
		{/if}
	</div>

	<div class="relative z-10 space-y-4">
		<div class="flex items-center gap-2">
			{#if Icon}
				<div class="p-2 rounded-lg bg-violet-500/10 text-violet-400">
					<Icon class="w-4 h-4" />
				</div>
			{/if}
			<h3 class="text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</h3>
		</div>

		<div class="flex items-baseline gap-2">
			<span class="text-3xl font-bold tracking-tight">{value}</span>
			{#if trend}
				<span class="text-xs {trend.isPositive ? 'text-green-500' : 'text-red-500'}">
					{trend.value}
				</span>
			{/if}
		</div>

		{#if description}
			<p class="text-xs text-zinc-500 line-clamp-1">{description}</p>
		{/if}
	</div>
</Card>
