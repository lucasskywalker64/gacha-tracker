<div class="flex min-h-screen flex-col items-center justify-center p-8 text-center">
	<h1
		class="animate-in fade-in slide-in-from-bottom-4 mb-4 text-6xl font-bold tracking-tight duration-1000"
	>
		Gacha Tracker
	</h1>
	<p class="text-muted-foreground mx-auto max-w-lg text-xl">
		High-performance, beautiful gacha history tracking powered by Svelte 5 and Tailwind v4.
	</p>

	<div class="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
		<div
			class="bg-surface-1 rounded-2xl border border-white/5 p-6 shadow-2xl transition-all hover:scale-105"
		>
			<div class="mb-2 text-sm font-medium uppercase tracking-wider text-rarity-3">3-Star</div>
			<div class="text-3xl font-bold">Resilience</div>
		</div>
		<div
			class="bg-surface-2 rounded-2xl border border-white/10 p-6 shadow-2xl transition-all hover:scale-105"
		>
			<div class="mb-2 text-sm font-medium uppercase tracking-wider text-rarity-4">4-Star</div>
			<div class="text-3xl font-bold">Evolution</div>
		</div>
		<div
			class="rounded-2xl border border-yellow-500/20 bg-linear-to-br from-yellow-500/10 to-transparent p-6 shadow-2xl transition-all hover:scale-105"
		>
			<div class="mb-2 text-sm font-medium uppercase tracking-wider text-rarity-5">5-Star</div>
			<div class="text-3xl font-bold text-rarity-5">Singularity</div>
		</div>
	</div>

	<button
		class="bg-accent hover:bg-accent-hover mt-16 rounded-full px-8 py-3 font-semibold text-white transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.5)] active:scale-95"
	>
		Get Started
	</button>
</div>
