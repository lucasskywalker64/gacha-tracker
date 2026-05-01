<script lang="ts">
	import type { RarityDisplayConfig } from '@gacha-tracker/shared';
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		rarity: number;
		rarityDisplay: RarityDisplayConfig[];
	}

	let { rarity, rarityDisplay }: Props = $props();

	let config = $derived(rarityDisplay.find((r) => r.value === rarity));
</script>

{#if config}
	<Badge
		variant="outline"
		class="{config.textColor} {config.bgColor} {config.borderColor} font-bold"
	>
		{config.label}
	</Badge>
{:else}
	<Badge variant="outline" class="text-zinc-500 bg-zinc-500/10 border-zinc-500/30">
		{rarity}★
	</Badge>
{/if}
