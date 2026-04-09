<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/navigation/app-sidebar.svelte';

	let { children } = $props();
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
