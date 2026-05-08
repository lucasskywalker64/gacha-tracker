<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { page, navigating } from '$app/state';
	import { authStore } from '$lib/stores/auth';
	import { fade } from 'svelte/transition';

	let { children } = $props();

	// Reactively update authStore based on page data
	$effect(() => {
		authStore.set(page.data.session);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if navigating.to}
	<div
		class="fixed inset-0 z-100 flex items-center justify-center bg-background/60 backdrop-blur-[2px]"
		transition:fade={{ duration: 200 }}
	>
		<div class="flex flex-col items-center gap-4">
			<div class="relative flex h-16 w-16 items-center justify-center">
				<!-- Outer spinning ring -->
				<div
					class="absolute h-full w-full animate-spin rounded-full border-4 border-violet-500/20 border-t-violet-500"
				></div>
				<!-- Inner pulsing star/icon -->
				<div class="h-6 w-6 animate-pulse rounded-full bg-violet-400 blur-[2px]"></div>
			</div>
			<p class="text-sm font-medium tracking-widest text-violet-300/80 uppercase">
				Synchronizing...
			</p>
		</div>
	</div>
{/if}

{@render children()}
