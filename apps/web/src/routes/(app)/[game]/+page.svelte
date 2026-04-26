<script lang="ts">
	import { api } from '$lib/api/client';
	import { GAME_CONFIGS, BANNER_NAMES } from '@gacha-tracker/shared';
	import PullRow from '$lib/components/pulls/PullRow.svelte';
	import PityBar from '$lib/components/pulls/PityBar.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Loader2, Filter, History, Star } from 'lucide-svelte';
	import * as Tabs from '$lib/components/ui/tabs';

	let { data } = $props();

	let gameId = $derived(data.gameId);
	let gameConfig = $derived(GAME_CONFIGS[gameId]);
	let bannerTypes = $derived(
		(gameConfig?.pityConfig.bannerOrder || []).map((id) => [
			id,
			BANNER_NAMES[gameId as keyof typeof BANNER_NAMES]?.[Number(id)] || id
		])
	);

	// svelte-ignore state_referenced_locally
	let pulls = $state(data.initialPulls.data);
	let totalPulls = $derived(data.initialPulls.meta.total || pulls.length);
	let stats = $derived(data.stats);

	let activeBanner = $state('all');
	let page = $state(1);
	let loading = $state(false);
	// svelte-ignore state_referenced_locally
	let hasMore = $state(data.initialPulls.meta.hasNextPage);

	// Watch for game change to reset state
	$effect(() => {
		if (data.gameId) {
			pulls = data.initialPulls.data;
			page = 1;
			activeBanner = 'all';
			hasMore = data.initialPulls.meta.hasNextPage;
		}
	});

	async function loadMore() {
		if (loading || !hasMore) return;
		loading = true;

		const nextPage = page + 1;
		const res = await api.pulls.get({
			query: {
				gameId,
				bannerType: activeBanner === 'all' ? undefined : activeBanner,
				page: nextPage,
				limit: 50
			}
		});

		if (res.data) {
			pulls = [...pulls, ...res.data.data];
			page = nextPage;
			hasMore = res.data.meta.hasNextPage;
		} else if (res.error) {
			console.error('Failed to load more pulls:', res.error);
		}

		loading = false;
	}

	async function handleBannerChange(value: string) {
		activeBanner = value;
		loading = true;
		page = 1;

		const res = await api.pulls.get({
			query: {
				gameId,
				bannerType: activeBanner === 'all' ? undefined : activeBanner,
				page: 1,
				limit: 50
			}
		});

		if (res.data) {
			pulls = res.data.data;
			hasMore = res.data.meta.hasNextPage;
		}

		loading = false;
	}
</script>

<div class="p-6 lg:p-10 space-y-8 max-w-7xl mx-auto">
	<!-- Header -->
	<div class="space-y-2">
		<h1 class="text-4xl font-black tracking-tight flex items-center gap-3">
			<History class="w-10 h-10 text-violet-500" />
			{gameConfig?.displayName || 'Game'} History
		</h1>
		<p class="text-zinc-500">
			{totalPulls.toLocaleString()} pulls total recorded for this game.
		</p>
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
		<!-- Main Content (Table) -->
		<div class="lg:col-span-8 space-y-6">
			<Tabs.Root value={activeBanner} onValueChange={handleBannerChange}>
				<div class="flex items-center justify-between gap-4 overflow-x-auto pb-2">
					<Tabs.List class="bg-zinc-900 border border-zinc-800">
						<Tabs.Trigger value="all">All Banners</Tabs.Trigger>
						{#each bannerTypes as [id, name] (id)}
							<Tabs.Trigger value={id}>{name}</Tabs.Trigger>
						{/each}
					</Tabs.List>

					<div class="flex items-center gap-2 text-xs text-zinc-500 whitespace-nowrap">
						<Filter class="w-3 h-3" />
						Showing {pulls.length} of {totalPulls}
					</div>
				</div>

				<div class="rounded-2xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
					<div class="overflow-x-auto">
						<table class="w-full text-left border-collapse">
							<thead>
								<tr class="bg-zinc-900/50 text-[10px] uppercase tracking-wider text-zinc-500">
									<th class="py-3 px-4 font-semibold">#</th>
									<th class="py-3 px-4 font-semibold">Item</th>
									<th class="py-3 px-4 font-semibold">Type</th>
									<th class="py-3 px-4 font-semibold">Rarity</th>
									<th class="py-3 px-4 font-semibold">Pity</th>
									<th class="py-3 px-4 font-semibold">Banner</th>
									<th class="py-3 px-4 font-semibold text-right">Date</th>
								</tr>
							</thead>
							<tbody>
								{#each pulls as pull, i (pull.id)}
									<PullRow
										{pull}
										index={totalPulls - ((page - 1) * 50 + i)}
										rarityDisplay={gameConfig?.rarityDisplay || []}
										softPityThreshold={gameConfig?.pityConfig.softPity[pull.bannerType]}
									/>
								{/each}
							</tbody>
						</table>
					</div>

					{#if pulls.length === 0 && !loading}
						<div class="p-20 text-center text-zinc-500">No pulls found for this filter.</div>
					{/if}

					{#if hasMore}
						<div class="p-6 flex justify-center border-t border-zinc-800/50">
							<Button
								variant="outline"
								onclick={loadMore}
								disabled={loading}
								class="border-zinc-800 hover:bg-zinc-800 min-w-[200px]"
							>
								{#if loading}
									<Loader2 class="w-4 h-4 animate-spin mr-2" />
									Loading...
								{:else}
									Load More
								{/if}
							</Button>
						</div>
					{/if}
				</div>
			</Tabs.Root>
		</div>

		<!-- Sidebar (Stats) -->
		<div class="lg:col-span-4 space-y-6">
			<Card class="p-6 bg-zinc-900/50 border-zinc-800 backdrop-blur-sm sticky top-24">
				<h2 class="text-xl font-bold mb-6 flex items-center gap-2">
					<Star class="w-5 h-5 text-yellow-500" />
					Current Pity
				</h2>

				<div class="space-y-8">
					{#if stats && gameConfig}
						{#each gameConfig.pityConfig.bannerOrder as type (type)}
							{@const hard = gameConfig.pityConfig.hardPity[type]}
							{@const bannerName =
								BANNER_NAMES[gameId as keyof typeof BANNER_NAMES]?.[Number(type)] || type}
							{@const lastFiveStar = stats.fiveStarHistory.find((h) => h.bannerType === type)}
							<PityBar
								currentPity={stats.currentPity[type] || 0}
								softPity={gameConfig.pityConfig.softPity[type]}
								hardPity={hard}
								bannerLabel={bannerName}
								isGuaranteed={lastFiveStar ? lastFiveStar.wasGuaranteed === 1 : false}
							/>
						{/each}
					{:else}
						<div class="text-center py-10 text-zinc-500">No stats available for this game.</div>
					{/if}
				</div>
			</Card>
		</div>
	</div>
</div>
