<script lang="ts">
	import { Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-svelte';

	interface Props {
		status: 'idle' | 'connecting' | 'listening' | 'success' | 'error' | 'timeout';
		result: { imported: number } | null;
	}

	let { status, result }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center py-12 px-6 text-center">
	{#if status === 'connecting' || status === 'listening'}
		<div class="relative mb-8">
			<div class="absolute inset-0 bg-yellow-400/20 blur-2xl rounded-full animate-pulse"></div>
			<Loader2 size={64} class="text-yellow-400 animate-spin relative" />
		</div>

		<h3 class="text-xl font-bold text-zinc-100 mb-3">
			{status === 'connecting' ? 'Establishing connection...' : 'Fetching your history...'}
		</h3>
		<p class="text-zinc-400 max-w-sm mx-auto leading-relaxed">
			Keep the game open on your history page. The script is working its magic! This may take a few
			moments.
		</p>

		<div class="mt-10 flex gap-1.5">
			<div
				class="w-2 h-2 rounded-full bg-yellow-400 animate-bounce"
				style="animation-delay: 0s"
			></div>
			<div
				class="w-2 h-2 rounded-full bg-yellow-400 animate-bounce"
				style="animation-delay: 0.2s"
			></div>
			<div
				class="w-2 h-2 rounded-full bg-yellow-400 animate-bounce"
				style="animation-delay: 0.4s"
			></div>
		</div>
	{:else if status === 'success'}
		<div class="relative mb-8">
			<div class="absolute inset-0 bg-green-400/20 blur-2xl rounded-full"></div>
			<CheckCircle2 size={64} class="text-green-400 relative" />
		</div>

		<h3 class="text-xl font-bold text-zinc-100 mb-3">Import Successful!</h3>
		<p class="text-zinc-400 max-w-sm mx-auto leading-relaxed">
			Found <span class="text-green-400 font-bold">{result?.imported ?? 0}</span> new pulls. Your dashboard
			and history have been updated.
		</p>
	{:else if status === 'error'}
		<div class="relative mb-8">
			<div class="absolute inset-0 bg-red-400/20 blur-2xl rounded-full"></div>
			<AlertCircle size={64} class="text-red-400 relative" />
		</div>

		<h3 class="text-xl font-bold text-zinc-100 mb-3">Import Failed</h3>
		<p class="text-zinc-400 max-w-sm mx-auto leading-relaxed mb-6">
			Something went wrong while communicating with the script.
		</p>
		<button
			onclick={() => window.location.reload()}
			class="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl font-semibold transition-all border border-zinc-700"
		>
			Try Again
		</button>
	{:else if status === 'timeout'}
		<div class="relative mb-8">
			<div class="absolute inset-0 bg-orange-400/20 blur-2xl rounded-full"></div>
			<Clock size={64} class="text-orange-400 relative" />
		</div>

		<h3 class="text-xl font-bold text-zinc-100 mb-3">Connection Timed Out</h3>
		<p class="text-zinc-400 max-w-sm mx-auto leading-relaxed mb-6">
			The script didn't finish in time. Please make sure your internet is stable and try again.
		</p>
		<button
			onclick={() => window.location.reload()}
			class="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl font-semibold transition-all border border-zinc-700"
		>
			Restart Wizard
		</button>
	{/if}
</div>
