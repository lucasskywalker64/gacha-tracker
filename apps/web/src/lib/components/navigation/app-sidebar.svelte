<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import GameSelector from './game-selector.svelte';
	import { LayoutDashboard, History, Download, LogOut, Settings } from 'lucide-svelte';
	import { selectedGame } from '$lib/stores/game';
	import { page } from '$app/stores';

	let currentPath = $derived($page.url.pathname as string);
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<div
			class="px-2 font-bold text-lg tracking-tight text-violet-500 flex items-center justify-center p-2 mb-2 bg-zinc-900/50 rounded-md border border-zinc-800"
		>
			GACHA TRACKER
		</div>
		<GameSelector />
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Overview</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={currentPath === '/dashboard'}>
							{#snippet child({ props })}
								<a href="/dashboard" {...props}>
									<LayoutDashboard class="w-4 h-4" />
									<span>Dashboard</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>

		<Sidebar.Group>
			<Sidebar.GroupLabel>Game</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={currentPath === `/${$selectedGame}`}>
							{#snippet child({ props })}
								<a href={`/${$selectedGame}`} {...props}>
									<History class="w-4 h-4" />
									<span>Pull History</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>

					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={currentPath === `/${$selectedGame}/import`}>
							{#snippet child({ props })}
								<a href={`/${$selectedGame}/import`} {...props} data-sveltekit-preload-data="off">
									<Download class="w-4 h-4" />
									<span>Import Pulls</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		<Sidebar.Separator class="my-2" />
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton>
							{#snippet child({ props })}
								<a href="/settings" {...props}>
									<Settings class="w-4 h-4" />
									<span>Settings</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton class="text-red-400 hover:text-red-500 hover:bg-red-400/10">
							<LogOut class="w-4 h-4" />
							<span>Sign out</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Footer>

	<Sidebar.Rail />
</Sidebar.Root>
