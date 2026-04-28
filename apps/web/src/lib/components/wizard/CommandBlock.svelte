<script lang="ts">
	import { Copy, Check } from 'lucide-svelte';

	interface Props {
		command: string;
	}
	let { command }: Props = $props();
	let copied = $state(false);

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(command);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch (err) {
			console.error('Failed to copy!', err);
		}
	}
</script>

<div
	class="group relative rounded-xl bg-zinc-950 border border-zinc-800 p-6 font-mono text-sm transition-colors hover:border-zinc-700"
>
	<div
		class="absolute -top-3 left-4 px-2 py-0.5 bg-zinc-800 text-[10px] uppercase tracking-widest text-zinc-400 rounded-md font-sans font-bold"
	>
		PowerShell Command
	</div>

	<pre
		class="overflow-x-auto whitespace-pre-wrap text-zinc-300 break-all pr-12 leading-relaxed">{command}</pre>

	<button
		onclick={copyToClipboard}
		class="absolute top-4 right-4 p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-all flex items-center justify-center shadow-lg"
		aria-label="Copy to clipboard"
	>
		{#if copied}
			<Check size={18} class="text-green-400" />
		{:else}
			<Copy size={18} />
		{/if}
	</button>
</div>
