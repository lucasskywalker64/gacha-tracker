<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { api } from '$lib/api/client';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { LoaderCircle, Palette, Settings } from 'lucide-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let settings = $state<PageData['settings'] | null>(null);

	// Editable fields
	let theme = $state<'system' | 'quantum-dark' | 'amber-dawn' | 'wobbly-waves'>('system');
	let originalTheme = $state<'system' | 'quantum-dark' | 'amber-dawn' | 'wobbly-waves'>('system');
	let pityDisplayMode = $state<'count_up' | 'count_down'>('count_up');

	// Sync local state when page data updates
	$effect(() => {
		if (data.settings) {
			settings = data.settings;
			theme =
				(data.settings.theme as 'system' | 'quantum-dark' | 'amber-dawn' | 'wobbly-waves') ||
				'system';
			originalTheme =
				(data.settings.theme as 'system' | 'quantum-dark' | 'amber-dawn' | 'wobbly-waves') ||
				'system';
			pityDisplayMode = (data.settings.pityDisplayMode as 'count_up' | 'count_down') || 'count_up';
		}
	});

	let saving = $state(false);

	onMount(async () => {
		// No auth methods fetching needed for themes
	});

	onDestroy(() => {
		// Revert client-side theme preview to original saved theme if navigated away without saving
		if (settings) {
			updateClientTheme(originalTheme);
		}
	});

	async function savePreferences() {
		saving = true;
		try {
			const { error } = await api.user.settings.patch({
				theme,
				pityDisplayMode
			});
			if (!error && settings) {
				settings = {
					...settings,
					theme,
					pityDisplayMode
				};
				originalTheme = theme; // Persist the theme choice as the original reference
				updateClientTheme(theme);
				alert('Preferences saved successfully.');
			} else if (error) {
				alert('Failed to save settings: ' + error.value);
			}
		} catch (err) {
			console.error('Failed to save settings:', err);
		} finally {
			saving = false;
		}
	}

	function updateClientTheme(selectedTheme: string) {
		const root = window.document.documentElement;
		root.classList.remove('theme-quantum-dark', 'theme-amber-dawn', 'theme-wobbly-waves');
		if (selectedTheme !== 'system' && selectedTheme !== 'light') {
			root.classList.add(`theme-${selectedTheme}`);
		}
	}
</script>

<div class="max-w-4xl mx-auto space-y-8 p-6 lg:p-10">
	<!-- Heading Section -->
	<div class="flex items-center gap-4">
		<div
			class="w-12 h-12 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-500"
		>
			<Settings class="w-6 h-6 animate-pulse" />
		</div>
		<div>
			<h1 class="text-3xl font-black tracking-tight text-white">Settings</h1>
			<p class="text-zinc-500 text-sm mt-1">
				Manage your design aesthetics and visual preference settings.
			</p>
		</div>
	</div>

	<Tabs.Root value="preferences" class="w-full">
		<Tabs.List
			class="grid w-full grid-cols-1 bg-zinc-900/50 border border-zinc-800 rounded-xl p-1 mb-6"
		>
			<Tabs.Trigger
				value="preferences"
				class="rounded-lg text-sm font-semibold text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-white cursor-pointer py-2"
			>
				Preferences
			</Tabs.Trigger>
		</Tabs.List>

		<!-- PREFERENCES PANEL -->
		<Tabs.Content value="preferences" class="space-y-6 outline-none">
			<Card.Root
				class="bg-zinc-950/60 backdrop-blur-xl border-zinc-800 rounded-2xl overflow-hidden shadow-xl shadow-black/30"
			>
				<Card.Header
					class="bg-linear-to-b from-zinc-900/50 to-transparent p-6 border-b border-zinc-900"
				>
					<div class="flex items-center gap-3">
						<Palette class="w-5 h-5 text-violet-400" />
						<Card.Title class="text-white text-lg font-bold">Design & Aesthetics</Card.Title>
					</div>
					<Card.Description class="text-zinc-500 mt-1"
						>Customize visual layouts, color themes, and pity counters display.</Card.Description
					>
				</Card.Header>
				<Card.Content class="p-6 space-y-8">
					<!-- Curated Themes Selector -->
					<div class="grid gap-3">
						<span class="text-xs font-bold text-zinc-400 uppercase tracking-wider"
							>Curated App Theme</span
						>
						<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
							<button
								type="button"
								onclick={() => {
									theme = 'system';
									updateClientTheme('system');
								}}
								class="p-4 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left transition-all hover:scale-[1.01] cursor-pointer {theme ===
								'system'
									? 'border-violet-500 ring-4 ring-violet-500/10'
									: 'border-zinc-800'}"
							>
								<span class="text-sm font-bold text-white block">Default Dark</span>
								<span class="text-xs text-zinc-500 block mt-1.5"
									>Standard deep space obsidian styling</span
								>
							</button>

							<button
								type="button"
								onclick={() => {
									theme = 'quantum-dark';
									updateClientTheme('quantum-dark');
								}}
								class="p-4 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left transition-all hover:scale-[1.01] cursor-pointer {theme ===
								'quantum-dark'
									? 'border-purple-500 ring-4 ring-purple-500/10'
									: 'border-zinc-800'}"
							>
								<span class="text-sm font-bold text-white block">Quantum Dark</span>
								<span class="text-xs text-purple-400 block mt-1.5"
									>HSR-inspired deep purple & obsidian</span
								>
							</button>

							<button
								type="button"
								onclick={() => {
									theme = 'amber-dawn';
									updateClientTheme('amber-dawn');
								}}
								class="p-4 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left transition-all hover:scale-[1.01] cursor-pointer {theme ===
								'amber-dawn'
									? 'border-yellow-600 ring-4 ring-yellow-600/10'
									: 'border-zinc-800'}"
							>
								<span class="text-sm font-bold text-white block">Amber Dawn</span>
								<span class="text-xs text-yellow-500 block mt-1.5"
									>Genshin-inspired warm golds & stones</span
								>
							</button>

							<button
								type="button"
								onclick={() => {
									theme = 'wobbly-waves';
									updateClientTheme('wobbly-waves');
								}}
								class="p-4 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left transition-all hover:scale-[1.01] cursor-pointer {theme ===
								'wobbly-waves'
									? 'border-teal-500 ring-4 ring-teal-500/10'
									: 'border-zinc-800'}"
							>
								<span class="text-sm font-bold text-white block">Wobbly Waves</span>
								<span class="text-xs text-teal-400 block mt-1.5"
									>WuWa-inspired glowing emeralds & navy</span
								>
							</button>
						</div>
					</div>

					<Separator class="bg-zinc-900" />

					<!-- Pity Counter Style -->
					<div class="grid gap-3">
						<span class="text-xs font-bold text-zinc-400 uppercase tracking-wider"
							>Pity Tracker Display Mode</span
						>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							<button
								type="button"
								onclick={() => (pityDisplayMode = 'count_up')}
								class="p-4 rounded-xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left cursor-pointer transition-all {pityDisplayMode ===
								'count_up'
									? 'border-zinc-400 ring-2 ring-white/5'
									: 'border-zinc-800'}"
							>
								<span class="text-sm font-bold text-white block">Standard Count-Up</span>
								<span class="text-xs text-zinc-500 block mt-1.5"
									>Pity counts up: "Pity: 67 / 90 pulls"</span
								>
							</button>
							<button
								type="button"
								onclick={() => (pityDisplayMode = 'count_down')}
								class="p-4 rounded-xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left cursor-pointer transition-all {pityDisplayMode ===
								'count_down'
									? 'border-zinc-400 ring-2 ring-white/5'
									: 'border-zinc-800'}"
							>
								<span class="text-sm font-bold text-white block">Hard Pity Countdown</span>
								<span class="text-xs text-zinc-500 block mt-1.5"
									>Countdown style: "23 pulls to Hard Pity"</span
								>
							</button>
						</div>
					</div>

					<!-- Save preferences button -->
					<div class="flex justify-end pt-4">
						<Button
							onclick={savePreferences}
							disabled={saving}
							class="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-violet-600/10 gap-2 cursor-pointer"
						>
							{#if saving}
								<LoaderCircle class="h-4 w-4 animate-spin" />Saving...
							{:else}
								Save Preferences
							{/if}
						</Button>
					</div>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>
	</Tabs.Root>
</div>
