<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api/client';
	import { authClient } from '$lib/api/auth';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/navigation/app-sidebar.svelte';

	let { children } = $props();

	onMount(async () => {
		try {
			const { data: settings } = await api.user.settings.get();
			if (settings?.theme) {
				const root = window.document.documentElement;
				root.classList.remove('theme-quantum-dark', 'theme-amber-dawn', 'theme-wobbly-waves');
				if (settings.theme !== 'system' && settings.theme !== 'light') {
					root.classList.add(`theme-${settings.theme}`);
				}
			}
		} catch (err) {
			console.error('Failed to load global theme settings:', err);
		}

		// Check client-assisted linking intent across tab boundaries
		try {
			const raw = localStorage.getItem('pending_social_link');
			if (raw) {
				localStorage.removeItem('pending_social_link'); // Consume/clean up immediately
				const intent = JSON.parse(raw);
				if (intent && Date.now() < intent.expiresAt) {
					// Trigger standard Better-Auth linking trip
					await authClient.linkSocial({ provider: intent.provider });
				}
			}
		} catch (e) {
			console.error('Failed to parse or trigger pending social link:', e);
		}
	});
</script>

<Sidebar.Provider>
	<AppSidebar />
	<!-- Application Main Content Area -->
	<Sidebar.Inset class="flex flex-col min-h-screen">
		<header
			class="flex h-14 items-center gap-4 border-b border-zinc-800 bg-background px-4 lg:h-[60px]"
		>
			<Sidebar.Trigger />
			<div class="flex-1">
				<!-- Header slot or breadcrumbs can go here -->
			</div>
		</header>
		<main class="flex-1 p-4 md:p-6 overflow-auto">
			{@render children()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
