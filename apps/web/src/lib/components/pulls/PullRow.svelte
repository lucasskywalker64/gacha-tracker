<script lang="ts">
	import type { Pull, RarityDisplayConfig } from '@gacha-tracker/shared';
	import { BANNER_NAMES } from '@gacha-tracker/shared';
	import RarityBadge from './RarityBadge.svelte';
	import { Lock } from 'lucide-svelte';
	import { format } from 'date-fns';

	interface Props {
		pull: Pull;
		index: number;
		rarityDisplay: RarityDisplayConfig[];
		softPityThreshold?: number;
		showAccount?: boolean;
		accountLabel?: string;
	}

	let {
		pull,
		index,
		rarityDisplay,
		softPityThreshold = 74,
		showAccount = false,
		accountLabel
	}: Props = $props();

	let bannerName = $derived(
		BANNER_NAMES[pull.gameId as keyof typeof BANNER_NAMES]?.[Number(pull.bannerType)] ??
			pull.bannerType
	);
	let isHighPity = $derived(pull.pityAtPull >= softPityThreshold);
	let rarityConfig = $derived(rarityDisplay.find((r) => r.value === pull.rarity));
</script>

<tr class="group border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
	<td class="py-3 px-4 text-xs text-zinc-500 tabular-nums">
		{index}
	</td>
	<td class="py-3 px-4">
		<div class="flex items-center gap-3">
			<div class="w-1.5 h-6 rounded-full {rarityConfig?.bgColor ?? 'bg-zinc-800'}"></div>
			<div class="min-w-0">
				<span class="font-medium text-sm block truncate">{pull.itemName}</span>
				{#if showAccount && accountLabel}
					<span
						class="text-[10px] text-zinc-400 font-mono inline-block px-1.5 py-0.2 rounded bg-zinc-850 border border-zinc-750 mt-0.5 truncate max-w-48"
					>
						{accountLabel}
					</span>
				{/if}
			</div>
		</div>
	</td>
	<td class="py-3 px-4 text-xs text-zinc-400">
		{pull.itemType}
	</td>
	<td class="py-3 px-4">
		<RarityBadge rarity={pull.rarity} {rarityDisplay} />
	</td>
	<td class="py-3 px-4">
		<div class="flex items-center gap-1.5">
			<span
				class="text-sm tabular-nums {isHighPity ? 'text-yellow-400 font-bold' : 'text-zinc-300'}"
			>
				{pull.pityAtPull}
			</span>
			{#if pull.wasGuaranteed}
				<Lock class="w-3 h-3 text-violet-400" />
			{/if}
		</div>
	</td>
	<td class="py-3 px-4 text-xs text-zinc-400">
		{bannerName}
	</td>
	<td class="py-3 px-4 text-xs text-zinc-500 text-right whitespace-nowrap">
		{format(pull.pulledAt, 'MMM d, yyyy')}
	</td>
</tr>
