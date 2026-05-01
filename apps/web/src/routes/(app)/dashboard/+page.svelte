<script lang="ts">
	import StatCard from '$lib/components/dashboard/StatCard.svelte';
	import GameCard from '$lib/components/dashboard/GameCard.svelte';
	import { GAME_CONFIGS } from '@gacha-tracker/shared';
	import { LayoutDashboard, Star, Gamepad2, ArrowUpRight, Plus } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';

	let { data } = $props();

	let userGames = $derived(data.userGames || []);
	let statsMap = $derived(data.statsMap || {});
	let totalStats = $derived(data.totalStats || { pulls: 0, fiveStars: 0 });
</script>

<div class="p-6 lg:p-10 space-y-10 max-w-7xl mx-auto">
	<!-- Header -->
	<div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
		<div class="space-y-2">
			<h1 class="text-4xl font-black tracking-tight flex items-center gap-3">
				<LayoutDashboard class="w-10 h-10 text-violet-500" />
				Dashboard
			</h1>
			<p class="text-zinc-500 max-w-md">Overview of your collection across all tracked games.</p>
		</div>

		<Button
			href="/import"
			class="bg-violet-600 hover:bg-violet-500 text-white font-bold px-6 shadow-lg shadow-violet-600/20 gap-2"
		>
			<Plus class="w-4 h-4" />
			Import New Pulls
		</Button>
	</div>

	<!-- Hero Stats -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
		<StatCard
			title="Total Pulls"
			value={totalStats.pulls.toLocaleString()}
			icon={Gamepad2}
			description="Accumulated across all games"
		/>
		<StatCard
			title="5★ Items"
			value={totalStats.fiveStars.toLocaleString()}
			icon={Star}
			description="Legendary items collected"
		/>
		<StatCard
			title="Games Tracked"
			value={userGames.length}
			icon={ArrowUpRight}
			description="Active gacha games in your profile"
		/>
	</div>

	<!-- Games Grid -->
	<div class="space-y-6">
		<div class="flex items-center justify-between">
			<h2 class="text-xl font-bold">Active Games</h2>
		</div>

		{#if userGames.length > 0}
			<div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
				{#each userGames as ug (ug.id)}
					{@const gameConfig = GAME_CONFIGS[ug.gameId]}
					{@const stats = statsMap[ug.gameId]}

					{#if gameConfig && stats}
						<GameCard
							gameId={ug.gameId}
							displayName={gameConfig.displayName}
							lastSync={ug.lastImport}
							totalPulls={stats.total}
							pityData={stats.currentPity}
							config={gameConfig}
						/>
					{/if}
				{/each}
			</div>
		{:else}
			<!-- Empty State -->
			<div
				class="border-2 border-dashed border-zinc-800 rounded-3xl p-20 flex flex-col items-center text-center space-y-6 bg-zinc-900/20"
			>
				<div
					class="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-600"
				>
					<Gamepad2 size={40} />
				</div>
				<div class="space-y-2">
					<h3 class="text-2xl font-bold">No games tracked yet</h3>
					<p class="text-zinc-500 max-w-sm">
						Import your pull history from Honkai: Star Rail or other supported games to see your
						stats here.
					</p>
				</div>
				<Button href="/import" variant="outline" class="border-zinc-700 hover:bg-zinc-800">
					Get Started
				</Button>
			</div>
		{/if}
	</div>
</div>
