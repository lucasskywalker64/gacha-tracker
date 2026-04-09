<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import { selectedGame, type SupportedGame } from '$lib/stores/game';
	import { ChevronDown, Gamepad2 } from 'lucide-svelte';

	const games: Record<SupportedGame, { name: string }> = {
		genshin: { name: 'Genshin Impact' },
		starrail: { name: 'Honkai: Star Rail' },
		zzz: { name: 'Zenless Zone Zero' },
		wuwa: { name: 'Wuthering Waves' }
	};

	let currentGameName = $derived(games[$selectedGame].name);

	function selectGame(game: SupportedGame) {
		$selectedGame = game;
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" class="w-full justify-between mt-2 px-2">
				<div class="flex items-center gap-2">
					<div class="flex h-6 w-6 items-center justify-center rounded bg-violet-600 text-white">
						<Gamepad2 class="h-4 w-4" />
					</div>
					<span class="font-medium">{currentGameName}</span>
				</div>
				<ChevronDown class="h-4 w-4 opacity-50" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="w-56 bg-zinc-950 border border-zinc-800" align="start">
		<DropdownMenu.Label>Select Game</DropdownMenu.Label>
		<DropdownMenu.Separator />
		{#each Object.entries(games) as [id, game] (id)}
			<DropdownMenu.Item onclick={() => selectGame(id as SupportedGame)}>
				<div class="flex flex-col gap-0.5">
					<span>{game.name}</span>
					<span class="text-[10px] text-muted-foreground uppercase hidden">Last synced 2d ago</span>
				</div>
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
