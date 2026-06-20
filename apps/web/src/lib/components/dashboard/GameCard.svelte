<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { ChevronRight, Clock, Database } from 'lucide-svelte';
	import { formatDistanceToNow } from 'date-fns';
	import PityBar from '../pulls/PityBar.svelte';
	import type { GameConfig } from '@gacha-tracker/shared';

	interface Props {
		gameId: string;
		displayName: string;
		lastSync: Date | number | null;
		totalPulls: number;
		pityData: Record<string, number>;
		config: GameConfig;
	}

	let { gameId, displayName, lastSync, totalPulls, pityData, config }: Props = $props();

	let banners = $derived(
		Object.entries(config.pityConfig.hardPity).map(([type, hard]) => ({
			type,
			hard,
			soft: config.pityConfig.softPity[type],
			current: pityData[type] || 0
		}))
	);
</script>

<Card
	class="bg-zinc-900/50 border-zinc-800 backdrop-blur-sm overflow-hidden flex flex-col p-0 gap-0"
>
	<div class="p-6 border-b border-zinc-800/50 bg-linear-to-br from-zinc-800/20 to-transparent">
		<div class="flex justify-between items-start mb-4">
			<div class="flex items-center gap-3">
				<div
					class="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-violet-600/20"
				>
					{displayName?.[0] ?? '?'}
				</div>
				<div>
					<h3 class="font-bold text-lg leading-tight">{displayName}</h3>
					<div class="flex items-center gap-1.5 text-xs text-zinc-500">
						<Database class="w-3 h-3" />
						<span>{totalPulls} pulls tracked</span>
					</div>
				</div>
			</div>
			<Button
				variant="ghost"
				size="icon"
				href="/{gameId}"
				class="hover:bg-violet-500/10 hover:text-violet-400"
			>
				<ChevronRight class="w-5 h-5" />
			</Button>
		</div>

		<div class="flex items-center gap-1.5 text-xs text-zinc-400">
			<Clock class="w-3 h-3" />
			{#if lastSync}
				<span>Last synced {formatDistanceToNow(lastSync)} ago</span>
			{:else}
				<span>Never synced</span>
			{/if}
		</div>
	</div>

	<div class="p-6 space-y-6 flex-1">
		{#each banners as banner (banner.type)}
			<PityBar
				currentPity={banner.current}
				softPity={banner.soft}
				hardPity={banner.hard}
				bannerLabel={banner.type}
			/>
		{/each}
	</div>

	<div class="p-4 bg-zinc-950/50 border-t border-zinc-800/50">
		<Button
			variant="outline"
			class="w-full border-zinc-800 hover:bg-zinc-800 hover:text-white"
			href="/{gameId}"
		>
			View Full History
		</Button>
	</div>
</Card>
