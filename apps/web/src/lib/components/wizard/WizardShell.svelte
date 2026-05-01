<script lang="ts">
	import { X } from 'lucide-svelte';
	import { resolve } from '$app/paths';

	interface Props {
		steps: string[];
		currentStep: number;
		gameDisplayName: string;
		gameId: string;
		children?: import('svelte').Snippet;
	}

	let { steps, currentStep, gameDisplayName, gameId, children }: Props = $props();
</script>

<div class="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-yellow-400/30">
	<!-- Header -->
	<header class="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
		<div class="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div
					class="w-8 h-8 rounded-lg bg-yellow-400 flex items-center justify-center text-zinc-950 font-bold shadow-lg shadow-yellow-400/20"
				>
					{gameDisplayName.charAt(0)}
				</div>
				<span class="font-semibold tracking-tight">{gameDisplayName} Import Wizard</span>
			</div>

			<a
				href={resolve(`/${gameId}`)}
				class="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors px-3 py-1.5 rounded-lg hover:bg-zinc-800"
			>
				<X size={16} />
				Cancel
			</a>
		</div>
	</header>

	<main class="max-w-3xl mx-auto px-4 py-12">
		<!-- Step Indicator -->
		<div class="relative mb-12">
			<div class="absolute top-5 left-0 w-full h-0.5 bg-zinc-800 -z-10"></div>
			<div
				class="absolute top-5 left-0 h-0.5 bg-yellow-400 transition-all duration-500 -z-10"
				style="width: {((currentStep - 1) / (steps.length - 1)) * 100}%"
			></div>

			<div class="flex justify-between">
				{#each steps as step, i (step)}
					<div class="flex flex-col items-center gap-3">
						<div
							class="w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300
              {i + 1 < currentStep
								? 'bg-yellow-400 border-yellow-400 text-zinc-950 shadow-lg shadow-yellow-400/20'
								: i + 1 === currentStep
									? 'bg-zinc-900 border-yellow-400 text-yellow-400 shadow-lg shadow-yellow-400/10'
									: 'bg-zinc-900 border-zinc-800 text-zinc-500'}"
						>
							{#if i + 1 < currentStep}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="w-6 h-6"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="3"
										d="M5 13l4 4L19 7"
									/>
								</svg>
							{:else}
								<span class="font-bold">{i + 1}</span>
							{/if}
						</div>
						<span
							class="text-xs font-medium uppercase tracking-wider transition-colors duration-300
              {i + 1 <= currentStep ? 'text-zinc-200' : 'text-zinc-500'}"
						>
							{step}
						</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Active Step Content -->
		<div class="min-h-[400px]">
			{@render children?.()}
		</div>
	</main>
</div>

<style>
	:global(body) {
		background-color: #09090b;
	}
</style>
