<script lang="ts">
	import { authClient } from '$lib/api/auth';
	import { PUBLIC_FRONTEND_URL, PUBLIC_API_URL } from '$env/static/public';
	import { api } from '$lib/api/client';
	import { extractApiError } from '$lib/api/error';
	import * as Button from '$lib/components/ui/button';
	import * as Input from '$lib/components/ui/input';
	import * as Separator from '$lib/components/ui/separator';
	import {
		Mail,
		Ghost,
		Loader2,
		Copy,
		Check,
		TriangleAlert,
		Lock,
		ArrowRight
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth';
	import { fade, scale } from 'svelte/transition';
	import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte';
	import GoogleIcon from '$lib/components/icons/GoogleIcon.svelte';

	let email = $state('');
	const isValidEmail = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
	let isLoading = $state(false);
	let errorMessage = $state('');

	let showOtpInput = $state(false);
	let primaryEmail = $state('');
	let otpValue = $state('');

	let anonStep = $state(1);
	let generatedCode = $state('');
	let confirmationCode = $state('');
	let hasCopied = $state(false);

	async function handleSocialLogin(provider: 'discord' | 'google') {
		isLoading = true;
		errorMessage = '';
		try {
			await authClient.signIn.social({
				provider,
				callbackURL: `${PUBLIC_FRONTEND_URL}/auth/callback`,
				errorCallbackURL: `${PUBLIC_FRONTEND_URL}/auth/callback`
			});
		} catch (e) {
			console.error(e);
			errorMessage = 'Social sign up failed.';
			isLoading = false;
		}
	}

	async function handleOtpSend() {
		if (!email) return;
		isLoading = true;
		errorMessage = '';
		try {
			const res = await fetch(`${PUBLIC_API_URL}/auth/otp/send`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ email })
			});

			const data = await res.json();
			if (res.ok && data.success) {
				primaryEmail = email;
				showOtpInput = true;
			} else {
				errorMessage = data.error?.message || 'Failed to send verification code.';
			}
		} catch (e) {
			console.error(e);
			errorMessage = 'Failed to send verification code.';
		} finally {
			isLoading = false;
		}
	}

	async function handleOtpVerify() {
		if (!otpValue || otpValue.length !== 6) return;
		isLoading = true;
		errorMessage = '';
		try {
			const { data, error } = await authClient.signIn.emailOtp({
				email: primaryEmail,
				otp: otpValue
			});
			if (error) {
				errorMessage = error.message || 'Verification failed.';
			} else if (data) {
				const sessionRes = await authClient.getSession();
				if (sessionRes.data) {
					authStore.set(sessionRes.data);
				}
				await goto(resolve('/'));
			}
		} catch (e) {
			console.error(e);
			errorMessage = 'Verification failed.';
		} finally {
			isLoading = false;
		}
	}

	async function handleGenerateAnonCode() {
		isLoading = true;
		errorMessage = '';
		try {
			const { data, error } = await api.auth.anonymous.generate.post();
			if (error) {
				errorMessage = extractApiError(error, 'Failed to generate code.');
			} else {
				generatedCode = data.code;
				anonStep = 2;
			}
		} catch (e) {
			console.error(e);
			errorMessage = 'Experimental auth generation failed.';
		} finally {
			isLoading = false;
		}
	}

	function copyToClipboard() {
		navigator.clipboard.writeText(generatedCode);
		hasCopied = true;
		setTimeout(() => (hasCopied = false), 2000);
	}

	async function handleConfirmAnonCode() {
		if (confirmationCode !== generatedCode) {
			errorMessage = 'The code you typed does not match. Please try again.';
			return;
		}

		isLoading = true;
		errorMessage = '';
		try {
			const { error } = await api.auth.anonymous.confirm.post({ code: confirmationCode });
			if (error) {
				errorMessage = extractApiError(error, 'Confirmation failed.');
			} else {
				await goto(resolve('/'));
			}
		} catch (e) {
			console.error(e);
			errorMessage = 'Anonymous account confirmation failed.';
		} finally {
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Register | Gacha Tracker</title>
</svelte:head>

<div class="space-y-6">
	<div class="space-y-2">
		<h2 class="text-2xl font-semibold tracking-tight">Create an account</h2>
		<p class="text-sm text-zinc-400">Join thousands of players optimizing their pulls</p>
	</div>

	{#if errorMessage}
		<div class="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
			{errorMessage}
		</div>
	{/if}

	{#if !showOtpInput}
		<div class="grid grid-cols-2 gap-3" transition:fade={{ duration: 150 }}>
			<Button.Root
				variant="outline"
				class="h-11 border-zinc-800 bg-surface-2 hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
				disabled={isLoading}
				onclick={() => handleSocialLogin('discord')}
			>
				<DiscordIcon class="h-4 w-4 text-[#5865F2]" />
				Discord
			</Button.Root>
			<Button.Root
				variant="outline"
				class="h-11 border-zinc-800 bg-surface-2 hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
				disabled={isLoading}
				onclick={() => handleSocialLogin('google')}
			>
				<GoogleIcon class="h-4 w-4" />
				Google
			</Button.Root>
		</div>

		<div class="relative py-2" transition:fade={{ duration: 150 }}>
			<div class="absolute inset-0 flex items-center">
				<Separator.Root class="w-full bg-zinc-800" />
			</div>
			<div class="relative flex justify-center text-xs uppercase">
				<span class="bg-surface-1 px-2 text-zinc-500">Or use email</span>
			</div>
		</div>

		<div class="space-y-4" transition:fade={{ duration: 150 }}>
			<div class="space-y-2">
				<div class="relative">
					<Mail class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
					<Input.Root
						type="email"
						placeholder="name@example.com"
						class="h-11 pl-10 border-zinc-800 bg-surface-2 focus-visible:ring-accent"
						bind:value={email}
						disabled={isLoading}
					/>
				</div>
				<Button.Root
					class="w-full h-11 bg-accent hover:bg-accent-hover text-white font-medium transition-all"
					disabled={isLoading || !isValidEmail}
					onclick={handleOtpSend}
				>
					{#if isLoading}
						<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					{/if}
					Send Verification Code
				</Button.Root>
			</div>
		</div>

		<div class="relative py-2" transition:fade={{ duration: 150 }}>
			<div class="absolute inset-0 flex items-center">
				<Separator.Root class="w-full bg-zinc-800" />
			</div>
			<div class="relative flex justify-center text-xs uppercase">
				<span class="bg-surface-1 px-2 text-zinc-500">Privacy Mode</span>
			</div>
		</div>

		<div
			class="rounded-xl bg-purple-500/5 border border-purple-500/10 p-5 space-y-5"
			transition:fade={{ duration: 150 }}
		>
			<div class="rounded-lg bg-red-400/10 border border-red-400/20 p-3 flex gap-3 items-start">
				<div class="p-1 rounded bg-red-400/20 shrink-0">
					<TriangleAlert class="h-3.5 w-3.5 text-red-400" />
				</div>
				<p class="text-[11px] text-red-300 leading-tight">
					<span class="font-bold block mb-1 uppercase tracking-wider">No Account Recovery</span>
					Privacy Mode accounts are not linked to an email. If you lose your code we can not recover your
					account.
				</p>
			</div>

			<div
				class="group relative rounded-lg bg-purple-500/5 border border-purple-500/10 p-5 flex flex-col justify-between transition-all hover:bg-purple-500/8 hover:border-purple-500/20"
			>
				<div class="space-y-4">
					<div class="flex items-center gap-3">
						<div class="p-2 rounded-lg bg-purple-500/10 ring-1 ring-purple-500/20">
							<Ghost class="h-4 w-4 text-purple-400" />
						</div>
						<h3 class="text-sm font-semibold text-purple-300 tracking-tight">Secret Code</h3>
					</div>
					<div class="space-y-3">
						<p class="text-[11px] text-zinc-500 leading-relaxed">
							Generate a unique 16-digit code for instant, anonymous access.
						</p>

						{#if anonStep === 1}
							<Button.Root
								variant="outline"
								class="w-full h-10 mt-2 border-purple-500/20 bg-purple-500/5 hover:bg-purple-500/10 text-purple-300 font-medium transition-colors"
								disabled={isLoading}
								onclick={handleGenerateAnonCode}
							>
								Generate Account Code
							</Button.Root>
						{/if}
					</div>

					{#if anonStep > 1}
						<div class="pt-2">
							{#if anonStep === 2}
								<div class="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
									<div class="relative">
										<div
											class="p-4 bg-black/40 border border-purple-500/30 rounded-lg text-center font-mono text-lg tracking-[0.2em] text-purple-200"
										>
											{generatedCode}
										</div>
										<button
											onclick={copyToClipboard}
											class="absolute right-2 top-2 p-2 hover:bg-white/5 rounded-md transition-colors text-zinc-400 hover:text-purple-300"
											title="Copy to clipboard"
										>
											{#if hasCopied}
												<Check class="h-4 w-4 text-green-400" />
											{:else}
												<Copy class="h-4 w-4" />
											{/if}
										</button>
									</div>
									<p class="text-[10px] text-center text-zinc-500 italic">
										Save this code somewhere safe. You will need it to login next time.
									</p>
									<Button.Root
										class="w-full h-10 bg-purple-600 hover:bg-purple-700 text-white"
										onclick={() => (anonStep = 3)}
									>
										I've saved my code
									</Button.Root>
								</div>
							{:else if anonStep === 3}
								<div class="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
									<div class="space-y-2">
										<label for="confirm" class="text-[10px] uppercase font-bold text-zinc-500 ml-1"
											>Confirm Code</label
										>
										<Input.Root
											id="confirm"
											type="text"
											placeholder="Type the 16-character code back"
											class="h-10 border-zinc-800 bg-surface-2 focus-visible:ring-purple-500 font-mono text-sm text-center"
											maxlength={16}
											bind:value={confirmationCode}
										/>
									</div>
									<div class="flex gap-2">
										<Button.Root
											variant="outline"
											class="flex-1 h-10 border-zinc-800 text-xs"
											onclick={() => (anonStep = 2)}
										>
											Back
										</Button.Root>
										<Button.Root
											class="flex-2 h-10 bg-purple-600 hover:bg-purple-700 text-white text-xs"
											disabled={isLoading || confirmationCode.length !== 16}
											onclick={handleConfirmAnonCode}
										>
											{#if isLoading}
												<Loader2 class="h-4 w-4 animate-spin mr-2" />
											{/if}
											Complete Setup
										</Button.Root>
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="pt-4 text-center text-sm text-zinc-400" transition:fade={{ duration: 150 }}>
			Already have an account?
			<a href="/login" class="text-accent hover:underline font-medium ml-1">Sign in</a>
		</div>
	{:else}
		<div
			transition:scale={{ start: 0.95, duration: 150 }}
			class="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 space-y-6"
		>
			<div class="flex items-center gap-3">
				<div
					class="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-500"
				>
					<Lock class="w-5 h-5" />
				</div>
				<div class="text-left">
					<h3 class="text-lg font-bold text-white">Verification Code</h3>
					<p class="text-xs text-zinc-505 mt-0.5">Please check your inbox.</p>
				</div>
			</div>

			<div class="space-y-4">
				<p class="text-sm text-zinc-300 leading-relaxed text-left">
					We sent a security code to <span class="font-mono text-white font-semibold">{email}</span
					>. Enter the 6-digit code below to register.
				</p>

				<div class="space-y-3">
					<input
						type="text"
						inputmode="numeric"
						maxlength="6"
						pattern="\d{6}"
						placeholder="000000"
						bind:value={otpValue}
						oninput={(e) => {
							otpValue = e.currentTarget.value.replace(/\D/g, '');
						}}
						disabled={isLoading}
						class="w-full text-center tracking-[12px] font-mono text-2xl font-bold py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white focus:outline-none focus:border-violet-500 transition-colors disabled:opacity-50"
					/>
				</div>
			</div>

			<div class="flex items-center justify-end gap-3 pt-2">
				<Button.Root
					variant="outline"
					disabled={isLoading}
					onclick={() => {
						showOtpInput = false;
						errorMessage = '';
					}}
					class="rounded-xl font-bold text-xs border-zinc-800 text-zinc-400 hover:bg-zinc-800 cursor-pointer h-10 px-4"
				>
					Back
				</Button.Root>
				<Button.Root
					disabled={isLoading || otpValue.length !== 6}
					onclick={handleOtpVerify}
					class="rounded-xl font-bold text-xs bg-violet-600 hover:bg-violet-500 text-white cursor-pointer h-10 px-4 flex items-center gap-1.5"
				>
					{#if isLoading}
						<Loader2 class="w-3.5 h-3.5 animate-spin" />
					{/if}
					Confirm & Register
					<ArrowRight class="w-3.5 h-3.5" />
				</Button.Root>
			</div>
		</div>
	{/if}
</div>
