<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { SCRIPT_VERSIONS, GITHUB_RAW_BASE } from '@gacha-tracker/shared';
	import { importWizard } from '$lib/stores/importWizard.svelte';
	import { connectImportSse, disconnectImportSse } from '$lib/stores/importSse.svelte';
	import WizardShell from '$lib/components/wizard/WizardShell.svelte';
	import WizardStep from '$lib/components/wizard/WizardStep.svelte';
	import CommandBlock from '$lib/components/wizard/CommandBlock.svelte';
	import ImportStatusDisplay from '$lib/components/wizard/ImportStatusDisplay.svelte';
	import { PUBLIC_API_URL } from '$env/static/public';
	import {
		ChevronRight,
		ChevronLeft,
		ExternalLink,
		Info,
		Clock,
		User,
		Plus,
		Crown,
		ChevronDown,
		Check,
		LoaderCircle,
		Sparkles
	} from 'lucide-svelte';

	let { data } = $props();

	const steps = ['Instructions', 'Run Script', 'Waiting...', 'Done!'];

	let switchingProfile = $state(false);
	let showProfileDropdown = $state(false);

	let selectedUid = $derived(data.selectedUid);
	let currentToken = $derived(data.token);
	let currentCursors = $derived(data.cursors);

	// Initialize store with data from current state
	$effect(() => {
		if (currentToken) {
			importWizard.setToken(currentToken, currentCursors);
		}
	});

	// Handle SSE connection based on step
	$effect(() => {
		if (importWizard.state.step === 2 || importWizard.state.step === 3) {
			connectImportSse(data.gameId, importWizard);
		} else if (importWizard.state.step === 4 || importWizard.state.step === 1) {
			disconnectImportSse();
		}
	});

	onDestroy(() => {
		disconnectImportSse();
		importWizard.reset();
	});

	const wizard = $derived(data.gameConfig.wizard);
	const sha = $derived(SCRIPT_VERSIONS[data.gameId as keyof typeof SCRIPT_VERSIONS]);
	const scriptUrl = $derived(wizard ? `${GITHUB_RAW_BASE}/${sha}/${wizard.scriptPath}` : '');

	// The PowerShell command to run
	const cursorsJson = $derived(currentCursors ? JSON.stringify(currentCursors) : '{}');
	const cleanApiUrl = $derived(PUBLIC_API_URL.replace(/\/+$/, ''));
	const command = $derived(
		`& ([scriptblock]::Create((irm "${scriptUrl}"))) -ImportToken "${currentToken}" -Cursors '${cursorsJson}' -ApiUrl "${cleanApiUrl}"`
	);

	const selectedAccount = $derived(
		selectedUid === 'new' ? null : (data.accounts || []).find((a) => a.gameUid === selectedUid)
	);

	async function handleProfileSelect(uid: string) {
		if (uid === selectedUid || switchingProfile) {
			showProfileDropdown = false;
			return;
		}
		switchingProfile = true;
		showProfileDropdown = false;
		try {
			const targetUrl = `/${data.gameId}/import?uid=${uid}`;
			await goto(targetUrl, { replaceState: true, noScroll: true, keepFocus: true });
		} catch (err) {
			console.error('Error switching profile:', err);
		} finally {
			switchingProfile = false;
		}
	}

	function handleNext() {
		importWizard.nextStep();
	}

	function handleBack() {
		importWizard.prevStep();
	}
</script>

<svelte:head>
	<title>Import {data.gameConfig.displayName} - Gacha Tracker</title>
</svelte:head>

{#snippet profileSelector()}
	<div class="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-3">
		<div class="flex items-center justify-between">
			<span
				class="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5"
			>
				<User class="w-3.5 h-3.5 text-violet-400" /> Target Profile & Sync Mode
			</span>
			{#if switchingProfile}
				<div class="flex items-center gap-1.5 text-xs text-violet-400">
					<LoaderCircle class="w-3.5 h-3.5 animate-spin" />
					<span>Updating cursors...</span>
				</div>
			{/if}
		</div>

		<div class="relative">
			<button
				type="button"
				disabled={switchingProfile}
				onclick={() => (showProfileDropdown = !showProfileDropdown)}
				class="w-full flex items-center justify-between p-3 rounded-xl bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 text-left transition-all cursor-pointer group shadow-inner"
			>
				<div class="flex items-center gap-3 min-w-0">
					<div
						class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 {selectedUid ===
						'new'
							? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
							: selectedAccount?.isPrimary
								? 'bg-violet-500/10 border border-violet-500/20 text-violet-400'
								: 'bg-zinc-900 border border-zinc-800 text-zinc-400'}"
					>
						{#if selectedUid === 'new'}
							<Sparkles class="w-4 h-4" />
						{:else if selectedAccount?.isPrimary}
							<Crown class="w-4 h-4" />
						{:else}
							<User class="w-4 h-4" />
						{/if}
					</div>

					<div class="min-w-0">
						<div class="flex items-center gap-2 flex-wrap">
							<span class="text-sm font-bold text-white truncate">
								{#if selectedUid === 'new'}
									New Profile / Full Sync
								{:else}
									{selectedAccount?.nickname || `UID: ${selectedAccount?.gameUid}`}
								{/if}
							</span>
							{#if selectedAccount?.isPrimary}
								<span
									class="px-1.5 py-0.2 text-[8px] font-black uppercase tracking-wider rounded bg-violet-500/20 text-violet-300 border border-violet-500/30"
								>
									Primary
								</span>
							{:else if selectedUid === 'new'}
								<span
									class="px-1.5 py-0.2 text-[8px] font-black uppercase tracking-wider rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
								>
									Fresh Sync
								</span>
							{/if}
						</div>

						<p class="text-xs text-zinc-500 font-mono mt-0.5 truncate">
							{#if selectedUid === 'new'}
								Pulls full history & auto-creates profile on first import
							{:else}
								UID: {selectedAccount?.gameUid}
								{#if currentCursors && Object.keys(currentCursors).length > 0}
									&bull; Incremental sync enabled ({Object.keys(currentCursors).length} banners)
								{:else}
									&bull; Full sync (no prior cursors)
								{/if}
							{/if}
						</p>
					</div>
				</div>

				<div
					class="flex items-center gap-2 text-zinc-500 group-hover:text-zinc-300 transition-colors shrink-0 ml-2"
				>
					<span class="text-xs font-semibold hidden sm:inline">Change</span>
					<ChevronDown
						class="w-4 h-4 {showProfileDropdown ? 'rotate-180' : ''} transition-transform"
					/>
				</div>
			</button>

			{#if showProfileDropdown}
				<button
					type="button"
					class="fixed inset-0 z-40 cursor-default"
					onclick={() => (showProfileDropdown = false)}
					aria-label="Close dropdown"
				></button>

				<div
					class="absolute left-0 right-0 top-full mt-2 rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl p-2 z-50 space-y-1 animate-in fade-in zoom-in-95 duration-150"
				>
					<div class="px-3 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
						Select Profile to Sync
					</div>

					{#each data.accounts || [] as acc (acc.id)}
						<button
							type="button"
							onclick={() => handleProfileSelect(acc.gameUid)}
							class="w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs font-semibold hover:bg-zinc-900 transition-colors cursor-pointer {selectedUid ===
							acc.gameUid
								? 'bg-violet-600/10 text-violet-400 border border-violet-500/20'
								: 'text-zinc-300'}"
						>
							<div class="flex items-center gap-2.5 min-w-0">
								<div
									class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 {acc.isPrimary
										? 'bg-violet-500/20 text-violet-300'
										: 'bg-zinc-900 text-zinc-400'}"
								>
									{#if acc.isPrimary}
										<Crown class="w-3.5 h-3.5" />
									{:else}
										<User class="w-3.5 h-3.5" />
									{/if}
								</div>
								<div class="truncate">
									<div class="flex items-center gap-1.5">
										<span class="truncate">{acc.nickname || `UID: ${acc.gameUid}`}</span>
										{#if acc.isPrimary}
											<span
												class="px-1.5 py-0.2 text-[8px] font-black uppercase tracking-wider rounded bg-violet-500/20 text-violet-300"
											>
												Primary
											</span>
										{/if}
									</div>
									<span class="text-[11px] text-zinc-500 font-mono block">
										UID: {acc.gameUid}
										{#if acc.lastImport}
											&bull; Last imported: {new Date(acc.lastImport).toLocaleDateString()}
										{/if}
									</span>
								</div>
							</div>
							{#if selectedUid === acc.gameUid}
								<Check class="w-4 h-4 text-violet-400 shrink-0" />
							{/if}
						</button>
					{/each}

					<div class="pt-1 border-t border-zinc-900">
						<button
							type="button"
							onclick={() => handleProfileSelect('new')}
							class="w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs font-semibold hover:bg-zinc-900 transition-colors cursor-pointer {selectedUid ===
							'new'
								? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
								: 'text-zinc-300'}"
						>
							<div class="flex items-center gap-2.5 min-w-0">
								<div
									class="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0"
								>
									<Plus class="w-3.5 h-3.5" />
								</div>
								<div class="truncate">
									<span class="font-bold text-white block">New Profile / Full Sync</span>
									<span class="text-[11px] text-zinc-500 font-mono block">
										Pulls all available history without stopping at previous cursors
									</span>
								</div>
							</div>
							{#if selectedUid === 'new'}
								<Check class="w-4 h-4 text-emerald-400 shrink-0" />
							{/if}
						</button>
					</div>
				</div>
			{/if}
		</div>

		<p class="text-[11px] text-zinc-500 leading-relaxed">
			<span class="text-zinc-400 font-medium">Note:</span> The script reads history from whichever game
			account is currently active in your game client. Selecting a profile here embeds its previous pull
			cursors for faster sync.
		</p>
	</div>
{/snippet}

<WizardShell
	{steps}
	currentStep={importWizard.state.step}
	gameDisplayName={data.gameConfig.displayName}
	gameId={data.gameId}
>
	{#if !wizard}
		<WizardStep title="Coming Soon" subtitle="Automated import is not yet available for this game.">
			<div class="py-12 flex flex-col items-center justify-center text-center space-y-4">
				<div
					class="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 mb-2"
				>
					<Clock size={32} />
				</div>
				<p class="text-zinc-400 max-w-sm">
					We're currently working on the extraction script for <span class="text-zinc-100 font-bold"
						>{data.gameConfig.displayName}</span
					>. Check back soon!
				</p>
			</div>
			{#snippet footer()}
				<a
					href="/{data.gameId}"
					class="flex items-center gap-2 px-5 py-2 text-zinc-400 hover:text-zinc-100 transition-colors font-medium"
				>
					<ChevronLeft size={18} />
					Back to Game
				</a>
				<div></div>
			{/snippet}
		</WizardStep>
	{:else if importWizard.state.step === 1}
		<WizardStep
			title="Prepare Your History"
			subtitle="Before running the script, we need the game to refresh its local cache."
		>
			<div class="space-y-6">
				{@render profileSelector()}

				<div class="flex gap-4 p-4 rounded-xl bg-yellow-400/5 border border-yellow-400/20">
					<div
						class="shrink-0 w-10 h-10 rounded-lg bg-yellow-400 flex items-center justify-center text-zinc-900 shadow-lg shadow-yellow-400/10"
					>
						<Info size={20} />
					</div>
					<div class="text-sm leading-relaxed">
						<span class="font-bold text-yellow-400">Important:</span> The extraction script works by
						reading the temporary web cache generated by the game. If you haven't opened the {wizard.historyName.toLowerCase()}
						records recently, the cache might be empty or expired.
					</div>
				</div>

				<ol class="space-y-4">
					<li class="flex gap-4">
						<div
							class="shrink-0 w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400"
						>
							1
						</div>
						<p class="text-zinc-300">
							Launch <span class="text-zinc-100 font-medium">{data.gameConfig.displayName}</span> and
							log in to your account.
						</p>
					</li>
					<li class="flex gap-4">
						<div
							class="shrink-0 w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400"
						>
							2
						</div>
						<p class="text-zinc-300">
							Open the <span class="text-zinc-100 font-medium">{wizard.historyName}</span> menu,
							then click on
							<span class="text-zinc-100 font-medium">{wizard.recordsName}</span>.
						</p>
					</li>
					<li class="flex gap-4">
						<div
							class="shrink-0 w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400"
						>
							3
						</div>
						<p class="text-zinc-300">
							Wait for the history to load. You don't need to scroll through all pages.
						</p>
					</li>
					<li class="flex gap-4">
						<div
							class="shrink-0 w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400"
						>
							4
						</div>
						<p class="text-zinc-300">
							Return to this window and click <span class="text-zinc-100 font-medium">Next</span>.
						</p>
					</li>
				</ol>

				<details class="group border border-zinc-800 rounded-xl bg-zinc-900/50 overflow-hidden">
					<summary
						class="p-4 flex items-center justify-between cursor-pointer list-none hover:bg-zinc-800/50 transition-colors"
					>
						<span class="text-sm font-medium text-zinc-300">Why is this needed?</span>
						<ChevronRight
							size={16}
							class="text-zinc-500 group-open:rotate-90 transition-transform"
						/>
					</summary>
					<div class="p-4 border-t border-zinc-800 text-sm text-zinc-400 leading-relaxed space-y-2">
						<p>
							{data.gameConfig.displayName} uses a secure URL to fetch your gacha history. This URL is
							stored in a temporary local file on your computer whenever you open the history in-game.
						</p>
						<p>
							Our script finds this file, extracts the URL, and securely sends your pull data
							directly to our database. We never see your login credentials.
						</p>
					</div>
				</details>
			</div>

			{#snippet footer()}
				<div></div>
				<button
					onclick={handleNext}
					class="flex items-center gap-2 px-6 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-zinc-950 rounded-xl font-bold transition-all shadow-lg shadow-yellow-400/20 active:scale-95 cursor-pointer"
				>
					Next
					<ChevronRight size={18} />
				</button>
			{/snippet}
		</WizardStep>
	{:else if importWizard.state.step === 2}
		<WizardStep
			title="Run the Script"
			subtitle="Copy and paste the command below into your PowerShell terminal."
		>
			<div class="space-y-6">
				{@render profileSelector()}

				<p class="text-zinc-300">
					Open <span class="font-bold text-zinc-100">Windows PowerShell</span> (search for "PowerShell"
					in the Start menu), paste the command, and press Enter.
				</p>

				<CommandBlock {command} />

				<div class="p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/50 space-y-3">
					<div class="flex items-start gap-3">
						<Info size={18} class="text-zinc-400 shrink-0 mt-0.5" />
						<div class="text-sm text-zinc-400 leading-relaxed">
							<span class="text-zinc-200 font-medium italic block mb-1">Privacy & Security:</span>
							The command downloads a verified PowerShell script directly from our official GitHub repository.
							You can verify the code at any time by visiting the repository.
						</div>
					</div>
				</div>

				<div class="flex items-center gap-2 text-xs text-zinc-500 italic">
					<div class="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
					Listening for your script to start...
				</div>
			</div>

			{#snippet footer()}
				<button
					onclick={handleBack}
					class="flex items-center gap-2 px-5 py-2 text-zinc-400 hover:text-zinc-100 transition-colors font-medium cursor-pointer"
				>
					<ChevronLeft size={18} />
					Back
				</button>
				<button
					onclick={handleNext}
					class="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl font-semibold transition-all border border-zinc-700 active:scale-95 cursor-pointer"
				>
					I've run it
				</button>
			{/snippet}
		</WizardStep>
	{:else if importWizard.state.step === 3}
		<WizardStep title="Live Import Status" subtitle="The script is communicating with our servers.">
			<ImportStatusDisplay status={importWizard.state.status} result={importWizard.state.result} />

			{#snippet footer()}
				<button
					onclick={handleBack}
					class="flex items-center gap-2 px-5 py-2 text-zinc-400 hover:text-zinc-100 transition-colors font-medium cursor-pointer"
				>
					<ChevronLeft size={18} />
					Back
				</button>
				<div></div>
			{/snippet}
		</WizardStep>
	{:else if importWizard.state.step === 4}
		<WizardStep title="Success!" subtitle="Your pull history has been updated.">
			<ImportStatusDisplay status="success" result={importWizard.state.result} />

			<div class="grid grid-cols-2 gap-4 mt-4">
				<a
					href="/{data.gameId}"
					class="flex flex-col items-center justify-center p-6 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-yellow-400/30 hover:bg-zinc-800 transition-all group"
				>
					<div
						class="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 mb-3 group-hover:bg-yellow-400/10 group-hover:text-yellow-400 transition-colors"
					>
						<ExternalLink size={24} />
					</div>
					<span class="font-bold text-zinc-100">View History</span>
					<span class="text-xs text-zinc-500">Check your new pity counters</span>
				</a>

				<button
					onclick={() => {
						importWizard.reset();
						window.location.reload(); // Force re-fetch of token
					}}
					class="flex flex-col items-center justify-center p-6 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-yellow-400/30 hover:bg-zinc-800 transition-all group cursor-pointer"
				>
					<div
						class="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 mb-3 group-hover:bg-yellow-400/10 group-hover:text-yellow-400 transition-colors"
					>
						<ChevronLeft size={24} />
					</div>
					<span class="font-bold text-zinc-100">Import Again</span>
					<span class="text-xs text-zinc-500">Add pulls for another account</span>
				</button>
			</div>

			{#snippet footer()}
				<div></div>
				<a
					href="/dashboard"
					class="px-8 py-3 bg-zinc-100 hover:bg-white text-zinc-950 rounded-2xl font-bold transition-all shadow-xl active:scale-95 cursor-pointer"
				>
					Back to Dashboard
				</a>
			{/snippet}
		</WizardStep>
	{/if}
</WizardShell>

<style>
	/* Custom scrollbar for details content */
	details div::-webkit-scrollbar {
		width: 4px;
	}
	details div::-webkit-scrollbar-thumb {
		background: #27272a;
		border-radius: 10px;
	}
</style>
