<script lang="ts">
	let { children } = $props();
</script>

<div
	class="fixed inset-0 -z-10 h-full w-full bg-background bg-[radial-gradient(#1a1a1a_1px,transparent_1px)] bg-size-[24px_24px]"
>
	<div class="absolute inset-x-0 top-0 h-96 bg-accent/10 blur-[100px] pointer-events-none"></div>
</div>

<div class="flex min-h-screen items-center justify-center p-4">
	<div class="w-full max-w-md">
		<div class="mb-8 text-center">
			<h1 class="text-3xl font-bold tracking-tight text-foreground">Gacha Tracker</h1>
			<p class="mt-2 text-sm text-zinc-400">Your pulls, your stats, your journey.</p>
		</div>

		<div class="relative group">
			<div
				class="absolute -inset-0.5 bg-linear-to-r from-accent to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-500"
			></div>
			<div
				class="relative bg-surface-1 border border-border/50 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl"
			>
				<main class="p-6 md:p-8">
					{@render children()}
				</main>
			</div>
		</div>

		<div class="mt-8 text-center">
			<p class="text-xs text-zinc-500">
				&copy; 2026 Gacha Tracker. Premium tracking for premium gachas.
			</p>
		</div>
	</div>
</div>
