<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { page, navigating } from '$app/stores';
	import { authStore } from '$lib/stores/auth';

	let { children } = $props();

	// Reactively update authStore based on page data
	$effect(() => {
		authStore.set($page.data.session);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if $navigating}
	<!-- Global Progress Bar -->
	<div
		class="fixed left-0 right-0 top-0 z-50 h-1 animate-pulse bg-violet-500"
		style="transition: width 0.2s"
	></div>
{/if}

{@render children()}
