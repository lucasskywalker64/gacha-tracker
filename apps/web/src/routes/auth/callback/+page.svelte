<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { api } from '$lib/api/client';
	import { authClient } from '$lib/api/auth';
	import { extractApiError } from '$lib/api/error';
	import { authStore } from '$lib/stores/auth';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import {
		Loader2,
		TriangleAlert,
		ShieldCheck,
		UserPlus,
		Clock,
		Lock,
		ArrowRight
	} from 'lucide-svelte';
	import { fade, scale } from 'svelte/transition';

	let loading = $state(true);
	let step = $state<'choice' | 'otp'>('choice');
	let errorState = $state<
		'account_conflict' | 'expired_token' | 'already_linked' | 'generic' | null
	>(null);
	let conflictDetails = $state<{ email: string; provider: string; token: string } | null>(null);
	let linkProviderName = $state<string | null>(null);
	let resolvingPath = $state(false);
	let otpCode = $state('');
	let otpLoading = $state(false);
	let inlineError = $state('');
	let customErrorMessage = $state('');
	let timeLeft = $state(300);
	let timerInterval: ReturnType<typeof setInterval> | undefined;

	function startTimer() {
		if (timerInterval) clearInterval(timerInterval);
		timeLeft = 300;
		timerInterval = setInterval(() => {
			if (timeLeft > 0) {
				timeLeft -= 1;
			} else {
				clearInterval(timerInterval);
				errorState = 'expired_token';
			}
		}, 1000);
	}

	onDestroy(() => {
		if (timerInterval) clearInterval(timerInterval);
	});

	async function handlePathA() {
		if (!conflictDetails) return;
		resolvingPath = true;
		inlineError = '';
		try {
			const { error } = await api.auth.conflict['send-otp'].post({
				conflictToken: conflictDetails.token
			});
			if (error) {
				inlineError = extractApiError(error, 'Failed to send OTP email.');
			} else {
				step = 'otp';
				startTimer();
			}
		} catch (err) {
			inlineError = 'Failed to send OTP.';
			console.error(err);
		} finally {
			resolvingPath = false;
		}
	}

	async function handlePathB() {
		if (!conflictDetails) return;
		resolvingPath = true;
		try {
			await authClient.signIn.social({
				provider: conflictDetails.provider as 'google' | 'discord',
				callbackURL: window.location.origin + '/auth/callback',
				errorCallbackURL: window.location.origin + '/auth/callback',
				additionalData: { isolate: true }
			});
		} catch (err) {
			console.error(err);
		} finally {
			resolvingPath = false;
		}
	}

	async function verifyOtp() {
		if (!conflictDetails || otpCode.length !== 6) return;
		otpLoading = true;
		inlineError = '';
		try {
			const { error } = await api.auth.conflict['verify-otp'].post({
				conflictToken: conflictDetails.token,
				code: otpCode
			});

			if (error) {
				const val = error.value as { error?: { code?: string } };
				const code = val?.error?.code;
				inlineError = extractApiError(error, 'Verification failed.');
				if (code === 'MAX_ATTEMPTS_EXCEEDED' || code === 'CONFLICT_EXPIRED') {
					errorState = code === 'CONFLICT_EXPIRED' ? 'expired_token' : 'generic';
				}
			} else {
				const { data: session } = await authClient.getSession();
				if (session) {
					authStore.set(session);
					await goto(resolve('/(app)/dashboard'));
				} else {
					inlineError = 'Session not found. Please log in again.';
				}
			}
		} catch (err) {
			inlineError = 'Verification failed.';
			console.error(err);
		} finally {
			otpLoading = false;
		}
	}

	onMount(async () => {
		try {
			const urlParams = new URLSearchParams(window.location.search);
			const errorParam = urlParams.get('error') || '';
			if (errorParam) {
				customErrorMessage = decodeURIComponent(errorParam);
			}
			const tokenFromUrl = urlParams.get('token') || '';

			const { data: session } = await authClient.getSession();
			if (session && !errorParam && !tokenFromUrl) {
				authStore.set(session);
				await goto(resolve('/(app)/dashboard'));
				return;
			}

			if (errorParam === 'account_already_linked_to_different_user') {
				try {
					const saved = sessionStorage.getItem('pending_link_provider');
					if (saved === 'google') {
						linkProviderName = 'Google';
					} else if (saved === 'discord') {
						linkProviderName = 'Discord';
					}
					sessionStorage.removeItem('pending_link_provider');
				} catch (e) {
					console.error('Failed to get pending_link_provider from sessionStorage:', e);
				}
				errorState = 'already_linked';
				loading = false;
				return;
			}

			const isConflict =
				errorParam.startsWith('account_conflict:') ||
				errorParam === 'account_conflict' ||
				errorParam === 'unable_to_link_account' ||
				tokenFromUrl !== '';

			if (isConflict) {
				let resolvedToken = tokenFromUrl;
				if (!resolvedToken && errorParam.startsWith('account_conflict:')) {
					resolvedToken = errorParam.split(':')[1] || '';
				}

				if (resolvedToken) {
					const { data, error } = await api.auth['conflict-details'].get({
						query: { token: resolvedToken }
					});

					if (!error && data) {
						conflictDetails = {
							email: data.email,
							provider: data.provider,
							token: resolvedToken
						};
						errorState = 'account_conflict';
						loading = false;
						return;
					} else if (
						error &&
						(error as { value?: { error?: { code?: string } } }).value?.error?.code ===
							'EXPIRED_CONFLICT_TOKEN'
					) {
						errorState = 'expired_token';
						loading = false;
						return;
					}
				}
			}

			await new Promise((res) => setTimeout(res, 500));

			const { data: finalSession } = await authClient.getSession();
			if (finalSession) {
				authStore.set(finalSession);
				await goto(resolve('/(app)/dashboard'));
			} else {
				errorState = 'generic';
				loading = false;
			}
		} catch (e) {
			console.error('Session verification failed:', e);
			errorState = 'generic';
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Synchronizing... | Gacha Tracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-black p-4">
	{#if loading}
		<div transition:fade={{ duration: 150 }} class="text-center space-y-6">
			<div class="relative flex justify-center">
				<div class="absolute inset-0 bg-violet-500/10 blur-2xl rounded-full"></div>
				<Loader2 class="h-12 w-12 animate-spin text-violet-500 relative" />
			</div>
			<div class="space-y-2">
				<h1 class="text-xl font-medium text-zinc-100">Synchronizing...</h1>
				<p class="text-sm text-zinc-500 max-w-xs mx-auto leading-normal">
					Finalizing your secure session. You'll be redirected shortly.
				</p>
			</div>
		</div>
	{:else if errorState === 'account_conflict' && conflictDetails}
		<div
			transition:scale={{ start: 0.95, duration: 150 }}
			class="w-full max-w-md bg-zinc-950/90 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-2xl p-6 space-y-6"
		>
			{#if step === 'choice'}
				<div class="flex items-center gap-3">
					<div
						class="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-500"
					>
						<ShieldCheck class="w-5 h-5" />
					</div>
					<div>
						<h3 class="text-lg font-bold text-white">Account Conflict</h3>
						<p class="text-xs text-zinc-500 mt-0.5">An account with your email already exists.</p>
					</div>
				</div>

				<div class="space-y-4">
					<p class="text-sm text-zinc-300 leading-relaxed">
						An account with the email <span class="font-mono text-white font-semibold"
							>{conflictDetails.email}</span
						> is already registered. How would you like to proceed?
					</p>

					{#if inlineError}
						<div
							class="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-red-400 text-xs"
						>
							<TriangleAlert class="w-4 h-4 shrink-0 mt-0.5" />
							<span>{inlineError}</span>
						</div>
					{/if}

					<div class="grid gap-3">
						<button
							type="button"
							disabled={resolvingPath}
							onclick={handlePathA}
							class="group flex items-start gap-4 p-4 rounded-xl border border-zinc-800 bg-zinc-900/10 text-left hover:bg-zinc-900/30 hover:border-violet-500/30 transition-all cursor-pointer disabled:opacity-50"
						>
							<div
								class="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5 group-hover:scale-105 transition-transform"
							>
								<ShieldCheck class="w-4 h-4" />
							</div>
							<div class="flex-1">
								<h4 class="text-sm font-bold text-white">Path A: Verify & Link Accounts</h4>
								<p class="text-xs text-zinc-400 mt-1 leading-relaxed">
									We will send a 6-digit verification code to your inbox to instantly confirm and
									link this {conflictDetails.provider} profile.
								</p>
							</div>
						</button>

						<button
							type="button"
							disabled={resolvingPath}
							onclick={handlePathB}
							class="group flex items-start gap-4 p-4 rounded-xl border border-zinc-800 bg-zinc-900/10 text-left hover:bg-zinc-900/30 hover:border-violet-500/30 transition-all cursor-pointer disabled:opacity-50"
						>
							<div
								class="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 shrink-0 mt-0.5 group-hover:scale-105 transition-transform"
							>
								<UserPlus class="w-4 h-4" />
							</div>
							<div class="flex-1">
								<h4 class="text-sm font-bold text-white">Path B: Keep Separate (Privacy Mode)</h4>
								<p class="text-xs text-zinc-400 mt-1 leading-relaxed">
									Keep them completely isolated. This registers a new, fresh profile under your {conflictDetails.provider}
									login.
								</p>
							</div>
						</button>
					</div>
				</div>

				<div class="flex items-center justify-end gap-3 pt-2">
					<Button
						variant="outline"
						disabled={resolvingPath}
						onclick={() => goto(resolve('/(auth)/login'))}
						class="rounded-xl font-bold text-xs border-zinc-800 text-zinc-400 hover:bg-zinc-900 cursor-pointer h-10 px-4"
					>
						Cancel
					</Button>
				</div>
			{:else if step === 'otp'}
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div
							class="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-500"
						>
							<Lock class="w-5 h-5" />
						</div>
						<div>
							<h3 class="text-lg font-bold text-white">Security Verification</h3>
							<p class="text-xs text-zinc-500 mt-0.5">Enter the 6-digit code sent to your email.</p>
						</div>
					</div>
					<div
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/20 text-xs font-mono text-zinc-400"
						class:text-amber-500={timeLeft <= 60}
					>
						<Clock class="w-3.5 h-3.5" />
						<span>{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</span>
					</div>
				</div>

				<div class="space-y-4">
					<p class="text-sm text-zinc-300 leading-relaxed">
						We sent a verification code to <span class="font-mono text-white font-semibold"
							>{conflictDetails.email}</span
						>. Please enter it below.
					</p>

					{#if inlineError}
						<div
							class="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-red-400 text-xs"
						>
							<TriangleAlert class="w-4 h-4 shrink-0 mt-0.5" />
							<span>{inlineError}</span>
						</div>
					{/if}

					<div class="space-y-3">
						<input
							type="text"
							inputmode="numeric"
							maxlength="6"
							pattern="\d{6}"
							placeholder="000000"
							bind:value={otpCode}
							oninput={(e) => {
								otpCode = e.currentTarget.value.replace(/\D/g, '');
							}}
							disabled={otpLoading}
							class="w-full text-center tracking-[12px] font-mono text-2xl font-bold py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white focus:outline-none focus:border-violet-500 transition-colors disabled:opacity-50"
						/>
					</div>
				</div>

				<div class="flex items-center justify-end gap-3 pt-2">
					<Button
						variant="outline"
						disabled={otpLoading}
						onclick={() => {
							step = 'choice';
							inlineError = '';
						}}
						class="rounded-xl font-bold text-xs border-zinc-800 text-zinc-400 hover:bg-zinc-900 cursor-pointer h-10 px-4"
					>
						Back
					</Button>
					<Button
						disabled={otpLoading || otpCode.length !== 6}
						onclick={verifyOtp}
						class="rounded-xl font-bold text-xs bg-violet-600 hover:bg-violet-500 text-white cursor-pointer h-10 px-4 flex items-center gap-1.5"
					>
						{#if otpLoading}
							<Loader2 class="w-3.5 h-3.5 animate-spin" />
						{/if}
						Confirm & Link
						<ArrowRight class="w-3.5 h-3.5" />
					</Button>
				</div>
			{/if}
		</div>
	{:else if errorState === 'already_linked'}
		<div
			transition:scale={{ start: 0.95, duration: 150 }}
			class="w-full max-w-lg bg-zinc-950/90 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-2xl p-6 space-y-6"
		>
			<div class="flex items-center gap-3">
				<div
					class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0"
				>
					<TriangleAlert class="w-5 h-5" />
				</div>
				<div>
					<h3 class="text-lg font-bold text-white">Account Already Linked</h3>
					<p class="text-xs text-zinc-500 mt-0.5">
						This external profile is connected to another user.
					</p>
				</div>
			</div>

			<div class="space-y-4">
				<p class="text-sm text-zinc-300 leading-relaxed">
					The {linkProviderName || 'Google or Discord'} account you tried to link is already associated
					with a different Gacha Tracker account. To prevent account hijacking, a single external profile
					cannot be linked to multiple accounts.
				</p>

				<div class="bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-4 space-y-3.5">
					<h4 class="text-xs font-bold text-zinc-400 uppercase tracking-wider">
						How to resolve this:
					</h4>

					<ol class="space-y-3 text-xs text-zinc-400">
						<li class="flex gap-3 items-start">
							<span
								class="flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 font-mono font-bold text-[10px] shrink-0 mt-0.5"
								>1</span
							>
							<div class="flex-1">
								<strong class="text-zinc-200">Log in to the old account:</strong>
								<p class="mt-0.5 leading-relaxed text-zinc-400">
									First, sign out of your current account. Then, sign in using the {linkProviderName ||
										'Google/Discord'} account you just tried to link.
								</p>
							</div>
						</li>
						<li class="flex gap-3 items-start">
							<span
								class="flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 font-mono font-bold text-[10px] shrink-0 mt-0.5"
								>2</span
							>
							<div class="flex-1">
								<strong class="text-zinc-200">Unlink or delete the connection:</strong>
								<p class="mt-0.5 leading-relaxed text-zinc-400">
									Go to <strong class="text-zinc-300">Settings &gt; Account</strong> and unlink the {linkProviderName ||
										'Discord/Google'} provider. (If it's your only login method, you'll need to link an
									email first, or delete that old account entirely in the Danger Zone).
								</p>
							</div>
						</li>
						<li class="flex gap-3 items-start">
							<span
								class="flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 font-mono font-bold text-[10px] shrink-0 mt-0.5"
								>3</span
							>
							<div class="flex-1">
								<strong class="text-zinc-200">Link to your new account:</strong>
								<p class="mt-0.5 leading-relaxed text-zinc-400">
									Sign out of that old account, log back into your current account, and try linking
									the {linkProviderName || 'Discord/Google'} connection again under Settings.
								</p>
							</div>
						</li>
					</ol>
				</div>
			</div>

			<div class="flex flex-col sm:flex-row gap-3 pt-2">
				<Button
					onclick={() => goto(resolve('/(app)/settings'))}
					class="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl h-11 cursor-pointer transition-colors"
				>
					Back to Settings
				</Button>
				<Button
					onclick={async () => {
						await authClient.signOut();
						window.location.href = '/login';
					}}
					variant="outline"
					class="flex-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-100 font-bold text-xs rounded-xl h-11 cursor-pointer transition-colors"
				>
					Sign Out to Switch Accounts
				</Button>
			</div>
		</div>
	{:else if errorState === 'expired_token'}
		<div
			transition:scale={{ start: 0.95, duration: 150 }}
			class="w-full max-w-md bg-zinc-950/90 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-2xl p-6 space-y-6 text-center"
		>
			<div class="flex justify-center">
				<div
					class="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400"
				>
					<TriangleAlert class="w-6 h-6 animate-bounce" />
				</div>
			</div>

			<div class="space-y-2">
				<h3 class="text-lg font-bold text-white">Session Expired</h3>
				<p class="text-sm text-zinc-400 leading-normal max-w-sm mx-auto">
					This authorization attempt has expired. For your security, please restart the sign-in
					process.
				</p>
			</div>

			<div class="pt-4">
				<Button
					onclick={() => goto(resolve('/(auth)/login'))}
					class="w-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-100 font-bold text-xs rounded-xl h-11 cursor-pointer"
				>
					Return to Login
				</Button>
			</div>
		</div>
	{:else}
		<div
			transition:scale={{ start: 0.95, duration: 150 }}
			class="w-full max-w-md bg-zinc-950/90 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-2xl p-6 space-y-6 text-center"
		>
			<div class="flex justify-center">
				<div
					class="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400"
				>
					<TriangleAlert class="w-6 h-6" />
				</div>
			</div>

			<div class="space-y-2">
				<h3 class="text-lg font-bold text-white">Verification Failed</h3>
				<p class="text-sm text-zinc-400 leading-normal max-w-sm mx-auto">
					{customErrorMessage ||
						'An unexpected error occurred during your secure session verification.'}
				</p>
			</div>

			<div class="pt-4">
				<Button
					onclick={() => goto(resolve('/(auth)/login'))}
					class="w-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-100 font-bold text-xs rounded-xl h-11 cursor-pointer"
				>
					Return to Login
				</Button>
			</div>
		</div>
	{/if}
</div>
