<script lang="ts">
	import { Lock } from 'lucide-svelte';
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		currentPity: number;
		softPity: number;
		hardPity: number;
		bannerLabel: string;
		isGuaranteed?: boolean;
		has5050?: boolean;
	}

	let {
		currentPity,
		softPity,
		hardPity,
		bannerLabel,
		isGuaranteed = false,
		has5050 = true
	}: Props = $props();

	let progress = $derived(hardPity > 0 ? (currentPity / hardPity) * 100 : 0);
	let softPityStart = $derived(hardPity > 0 ? (softPity / hardPity) * 100 : 0);

	let colorClass = $derived.by(() => {
		if (currentPity >= hardPity - 1) return 'bg-red-500';
		if (currentPity >= softPity) return 'bg-yellow-500';
		return 'bg-green-500';
	});
</script>

<div class="space-y-2">
	<div class="flex justify-between items-end">
		<div class="space-y-0.5">
			<span class="text-sm font-medium text-zinc-400">{bannerLabel}</span>
			<div class="flex items-center gap-2">
				<span class="text-2xl font-bold tabular-nums">{currentPity}</span>
				<span class="text-sm text-zinc-500">/ {hardPity}</span>
			</div>
		</div>
		{#if has5050}
			{#if isGuaranteed}
				<Badge
					variant="outline"
					class="bg-violet-500/10 text-violet-400 border-violet-500/30 gap-1"
				>
					<Lock class="w-3 h-3" />
					Guaranteed
				</Badge>
			{:else}
				<Badge variant="outline" class="text-zinc-500 border-zinc-800">50/50</Badge>
			{/if}
		{/if}
	</div>

	<div class="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
		<!-- Soft pity indicator -->
		<div
			class="absolute top-0 bottom-0 bg-yellow-500/20"
			style="left: {softPityStart}%; right: 0;"
		></div>

		<!-- Progress fill -->
		<div
			class="h-full w-full flex-1 transition-all duration-500 ease-out {colorClass}"
			style="transform: translateX(-{100 - progress}%);"
		></div>
	</div>

	<div class="flex justify-between text-[10px] text-zinc-500 uppercase tracking-wider">
		<span>0</span>
		<span>Soft: {softPity}</span>
		<span>{hardPity}</span>
	</div>
</div>
