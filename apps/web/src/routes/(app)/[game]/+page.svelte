<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import { api } from '$lib/api/client';
	import { GAME_CONFIGS, BANNER_NAMES, type GameStats, type UserGame } from '@gacha-tracker/shared';
	import PullRow from '$lib/components/pulls/PullRow.svelte';
	import PityBar from '$lib/components/pulls/PityBar.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { LoaderCircle, Funnel, Star, User, Users, ChevronDown, Check } from 'lucide-svelte';
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

	let accounts = $derived((data.accounts || []) as UserGame[]);
	// svelte-ignore state_referenced_locally
	let selectedUid = $state(data.selectedUid || 'all');

	// svelte-ignore state_referenced_locally
	let pulls = $state(data.initialPulls.data);
	// svelte-ignore state_referenced_locally
	let totalPulls = $state(data.initialPulls.meta.total || data.initialPulls.data.length);
	// svelte-ignore state_referenced_locally
	let stats = $state<GameStats | null>(data.stats);

	let activeBanner = $state('all');
	let page = $state(1);
	let loading = $state(false);
	// svelte-ignore state_referenced_locally
	let hasMore = $state(data.initialPulls.meta.hasNextPage);
	let showAccountDropdown = $state(false);

	let requestToken = 0;

	// Watch for game / account change to reset state
	$effect(() => {
		if (data.gameId) {
			requestToken += 1;
			loading = false;
			pulls = data.initialPulls.data;
			totalPulls = data.initialPulls.meta.total || data.initialPulls.data.length;
			stats = data.stats;
			page = 1;
			activeBanner = 'all';
			hasMore = data.initialPulls.meta.hasNextPage;
			selectedUid = data.selectedUid || 'all';
		}
	});

	function checkHas5050(game: string, type: string): boolean {
		const typeNum = Number(type);
		if (game === 'zzz') {
			return typeNum === 2 || typeNum === 3;
		}
		if (game === 'genshin') {
			return typeNum === 301 || typeNum === 302 || typeNum === 400 || typeNum === 500;
		}
		if (game === 'starrail') {
			return typeNum === 11 || typeNum === 12;
		}
		if (game === 'wuwa') {
			return typeNum === 1 || typeNum === 10 || typeNum === 12;
		}
		return false;
	}

	function isBannerGuaranteed(
		game: string,
		type: string,
		history: GameStats['fiveStarHistory'] | undefined,
		targetUid: string | undefined
	): boolean {
		if (!checkHas5050(game, type) || !history || history.length === 0) return false;

		// Filter history to target account if specified
		const accountHistory = targetUid ? history.filter((h) => h.gameUid === targetUid) : history;

		// Find the most recent 5-star for this banner or its shared pool
		const lastFiveStar = accountHistory.find((h) => {
			if (h.bannerType === type) return true;
			// Shared pool banner checks
			if (game === 'genshin') {
				if (
					(type === '301' || type === '400') &&
					(h.bannerType === '301' || h.bannerType === '400')
				) {
					return true;
				}
			}
			if (game === 'wuwa') {
				if (
					(type === '1' || type === '10' || type === '12') &&
					(h.bannerType === '1' || h.bannerType === '10' || h.bannerType === '12')
				) {
					return true;
				}
				if (
					(type === '2' || type === '11' || type === '13') &&
					(h.bannerType === '2' || h.bannerType === '11' || h.bannerType === '13')
				) {
					return true;
				}
			}
			return false;
		});

		if (!lastFiveStar) return false;
		return lastFiveStar.itemId !== lastFiveStar.bannerId;
	}

	async function loadMore() {
		if (loading || !hasMore) return;
		loading = true;
		const token = ++requestToken;

		const nextPage = page + 1;
		const res = await api.pulls.get({
			query: {
				gameId,
				gameUid: selectedUid,
				bannerType: activeBanner === 'all' ? undefined : activeBanner,
				page: nextPage,
				limit: 50
			}
		});

		if (token !== requestToken) return;

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
		const token = ++requestToken;

		const res = await api.pulls.get({
			query: {
				gameId,
				gameUid: selectedUid,
				bannerType: activeBanner === 'all' ? undefined : activeBanner,
				page: 1,
				limit: 50
			}
		});

		if (token !== requestToken) return;

		if (res.data) {
			pulls = res.data.data;
			totalPulls = res.data.meta.total;
			hasMore = res.data.meta.hasNextPage;
		} else {
			pulls = [];
			totalPulls = 0;
			hasMore = false;
		}

		loading = false;
	}

	async function handleAccountChange(uid: string) {
		selectedUid = uid;
		showAccountDropdown = false;
		loading = true;
		page = 1;
		const token = ++requestToken;

		// Update URL
		const url = new URL(pageState.url);
		url.searchParams.set('uid', uid);
		replaceState(url, {});

		const [pullsRes, statsRes] = await Promise.all([
			api.pulls.get({
				query: {
					gameId,
					gameUid: selectedUid,
					bannerType: activeBanner === 'all' ? undefined : activeBanner,
					page: 1,
					limit: 50
				}
			}),
			api.stats({ gameId }).get({
				query: {
					gameUid: selectedUid
				}
			})
		]);

		if (token !== requestToken) return;

		if (pullsRes.data) {
			pulls = pullsRes.data.data;
			totalPulls = pullsRes.data.meta.total;
			hasMore = pullsRes.data.meta.hasNextPage;
		} else {
			pulls = [];
			totalPulls = 0;
			hasMore = false;
		}
		if (statsRes.data) {
			stats = statsRes.data as GameStats;
		} else {
			stats = null;
		}

		loading = false;
	}

	let currentAccount = $derived(accounts.find((a) => a.gameUid === selectedUid));
	let currentAccountLabel = $derived(
		selectedUid === 'all'
			? 'All Accounts'
			: currentAccount
				? currentAccount.nickname
					? `${currentAccount.nickname} (${currentAccount.gameUid})`
					: `UID: ${currentAccount.gameUid}`
				: `UID: ${selectedUid}`
	);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') showAccountDropdown = false;
	}}
/>

<div class="p-6 lg:p-10 space-y-8 max-w-7xl mx-auto">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
		<div class="space-y-2">
			<h1 class="text-4xl font-black tracking-tight flex items-center gap-3">
				<span class="bg-linear-to-r from-white to-zinc-400 bg-clip-text text-transparent">
					{gameConfig?.displayName || gameId}
				</span>
			</h1>
			<p class="text-zinc-400 text-sm">
				{totalPulls.toLocaleString()} pulls total recorded for this game.
			</p>
		</div>

		<!-- UID Selector Dropdown -->
		{#if accounts.length > 0}
			<div class="relative">
				<button
					type="button"
					onclick={() => (showAccountDropdown = !showAccountDropdown)}
					aria-haspopup="menu"
					aria-expanded={showAccountDropdown}
					class="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-all text-xs font-semibold text-zinc-200 cursor-pointer shadow-lg hover:shadow-violet-950/20"
				>
					<div class="w-2.5 h-2.5 rounded-full bg-violet-500"></div>
					<div class="flex items-center gap-2">
						{#if selectedUid === 'all'}
							<Users class="w-4 h-4 text-violet-400" />
						{:else}
							<User class="w-4 h-4 text-violet-400" />
						{/if}
						<span>{currentAccountLabel}</span>
						{#if currentAccount?.isPrimary}
							<span
								class="px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider rounded bg-violet-500/20 text-violet-300 border border-violet-500/30"
							>
								Primary
							</span>
						{/if}
					</div>
					<ChevronDown class="w-4 h-4 text-zinc-400 ml-1" />
				</button>

				{#if showAccountDropdown}
					<div
						class="fixed inset-0 z-40 cursor-default"
						aria-hidden="true"
						onclick={() => (showAccountDropdown = false)}
					></div>

					<!-- Dropdown menu -->
					<div
						role="menu"
						class="absolute right-0 mt-2 w-72 rounded-2xl bg-zinc-950 border border-zinc-800/90 shadow-2xl p-2 z-50 space-y-1"
					>
						<div class="px-3 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
							Select Account
						</div>

						<button
							type="button"
							role="menuitem"
							onclick={() => handleAccountChange('all')}
							class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs font-semibold hover:bg-zinc-900 transition-colors {selectedUid ===
							'all'
								? 'bg-violet-600/10 text-violet-400 border border-violet-500/20'
								: 'text-zinc-300'}"
						>
							<div class="flex items-center gap-2.5">
								<Users class="w-4 h-4 text-zinc-400" />
								<span>All Accounts (Aggregated)</span>
							</div>
							{#if selectedUid === 'all'}
								<Check class="w-4 h-4 text-violet-400" />
							{/if}
						</button>

						{#each accounts as acc (acc.id)}
							<button
								type="button"
								role="menuitem"
								onclick={() => handleAccountChange(acc.gameUid)}
								class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs font-semibold hover:bg-zinc-900 transition-colors {selectedUid ===
								acc.gameUid
									? 'bg-violet-600/10 text-violet-400 border border-violet-500/20'
									: 'text-zinc-300'}"
							>
								<div class="flex items-center gap-2.5 min-w-0">
									<User class="w-4 h-4 text-zinc-400 shrink-0" />
									<div class="truncate">
										<div class="flex items-center gap-1.5">
											<span class="truncate">{acc.nickname || `UID: ${acc.gameUid}`}</span>
											{#if acc.isPrimary}
												<span
													class="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider rounded bg-violet-500/20 text-violet-300 border border-violet-500/30"
												>
													Primary
												</span>
											{/if}
										</div>
										{#if acc.nickname}
											<span class="text-[10px] text-zinc-500 font-mono block">
												UID: {acc.gameUid}
											</span>
										{/if}
									</div>
								</div>
								{#if selectedUid === acc.gameUid}
									<Check class="w-4 h-4 text-violet-400 shrink-0 ml-2" />
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
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
						<Funnel class="w-3 h-3" />
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
									{@const pullAccount = accounts.find((a) => a.gameUid === pull.gameUid)}
									{@const pullAccountLabel = pullAccount
										? pullAccount.nickname
											? `${pullAccount.nickname} (${pullAccount.gameUid})`
											: `UID: ${pullAccount.gameUid}`
										: `UID: ${pull.gameUid}`}
									<PullRow
										{pull}
										index={totalPulls - i}
										rarityDisplay={gameConfig?.rarityDisplay || []}
										softPityThreshold={gameConfig?.pityConfig.softPity[pull.bannerType]}
										showAccount={selectedUid === 'all' && accounts.length > 1}
										accountLabel={pullAccountLabel}
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
								class="border-zinc-800 hover:bg-zinc-800 min-w-50"
							>
								{#if loading}
									<LoaderCircle class="w-4 h-4 animate-spin mr-2" />
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
				<div class="flex items-center justify-between mb-6 flex-wrap gap-2">
					<h2 class="text-xl font-bold flex items-center gap-2">
						<Star class="w-5 h-5 text-yellow-500" />
						Current Pity
					</h2>
					{#if selectedUid === 'all' && accounts.length > 0}
						{@const primaryUid = accounts.find((a) => a.isPrimary)?.gameUid || accounts[0]?.gameUid}
						{@const primaryAcc = accounts.find((a) => a.gameUid === primaryUid)}
						<span
							class="text-[10px] font-bold text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full"
						>
							{primaryAcc?.nickname ? `${primaryAcc.nickname}` : 'Primary Profile'}
						</span>
					{/if}
				</div>

				<div class="space-y-8">
					{#if stats && gameConfig}
						{#each gameConfig.pityConfig.bannerOrder as type (type)}
							{@const hard = gameConfig.pityConfig.hardPity[type]}
							{@const bannerName =
								BANNER_NAMES[gameId as keyof typeof BANNER_NAMES]?.[Number(type)] || type}
							{@const effectiveSidebarUid =
								selectedUid === 'all'
									? accounts.find((a) => a.isPrimary)?.gameUid || accounts[0]?.gameUid
									: selectedUid}
							{@const has5050 = checkHas5050(gameId, type)}
							{@const isGuaranteed = isBannerGuaranteed(
								gameId,
								type,
								stats?.fiveStarHistory,
								effectiveSidebarUid
							)}
							<PityBar
								currentPity={stats.currentPity[type] || 0}
								softPity={gameConfig.pityConfig.softPity[type]}
								hardPity={hard}
								bannerLabel={bannerName}
								{has5050}
								{isGuaranteed}
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
