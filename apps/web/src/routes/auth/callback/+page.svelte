<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient } from '$lib/api/auth';
	import { authStore } from '$lib/stores/auth';
	import { goto } from '$app/navigation';
	import { Loader2 } from 'lucide-svelte';

	onMount(async () => {
		try {
			// Small delay to ensure cookies are processed by the browser
			await new Promise((resolve) => setTimeout(resolve, 500));

			const { data: session } = await authClient.getSession();
			if (session) {
				authStore.set(session);
				await goto('/dashboard');
			} else {
				await goto('/login?error=unauthorized');
			}
		} catch (e) {
			console.error('Session verification failed:', e);
			await goto('/login?error=callback_failed');
		}
	});
</script>

<svelte:head>
	<title>Verifying... | Gacha Tracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background">
	<div class="text-center space-y-6">
		<div class="relative flex justify-center">
			<div class="absolute inset-0 bg-accent/20 blur-2xl rounded-full"></div>
			<Loader2 class="h-12 w-12 animate-spin text-accent relative" />
		</div>
		<div class="space-y-2">
			<h1 class="text-xl font-medium text-zinc-100">Synchronizing...</h1>
			<p class="text-sm text-zinc-500 max-w-xs mx-auto">
				Finalizing your secure session. You'll be redirected shortly.
			</p>
		</div>
	</div>
</div>
