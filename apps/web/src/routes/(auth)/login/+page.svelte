<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient } from '$lib/api/auth';
	import { PUBLIC_FRONTEND_URL, PUBLIC_API_URL } from '$env/static/public';
	import { api } from '$lib/api/client';
	import { extractApiError } from '$lib/api/error';
	import * as Button from '$lib/components/ui/button';
	import * as Input from '$lib/components/ui/input';
	import * as Separator from '$lib/components/ui/separator';
	import { Mail, UserKey, Ghost, Loader2, ShieldCheck, Lock, ArrowRight } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth';
	import { fade, scale } from 'svelte/transition';
	import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte';
	import GoogleIcon from '$lib/components/icons/GoogleIcon.svelte';

	let email = $state('');
	const isValidEmail = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
	let anonymousCode = $state('');
	let isLoading = $state(false);
	let errorMessage = $state('');

	let verifyAndLink = $state(false);

	let showOtpInput = $state(false);
	let primaryEmail = $state('');
	let otpValue = $state('');

	onMount(() => {
		const urlParams = new URLSearchParams(window.location.search);
		if (urlParams.get('verify_and_link') === 'true') {
			verifyAndLink = true;
		}
	});

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
			errorMessage = 'Social login failed. Please try again.';
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

	async function handlePasskey() {
		isLoading = true;
		errorMessage = '';
		try {
			const { data, error } = await authClient.signIn.passkey();
			if (error) {
				errorMessage = error.message || 'Passkey login failed.';
				return;
			}
			if (data) {
				authStore.set(data);
				await goto(resolve('/'));
			}
		} catch (e) {
			console.error(e);
			errorMessage = 'Passkey login failed.';
		} finally {
			isLoading = false;
		}
	}

	async function handleAnonymousLogin() {
		if (!anonymousCode) return;
		isLoading = true;
		errorMessage = '';
		try {
			const { error } = await api.auth.anonymous.login.post({ code: anonymousCode });
			if (error) {
				const errMsg = extractApiError(error, '');
				errorMessage = errMsg.split(':')[0] || 'Invalid code.';
			} else {
				await goto(resolve('/'));
			}
		} catch (e) {
			console.error(e);
			errorMessage = 'Anonymous login failed.';
		} finally {
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Login | Gacha Tracker</title>
</svelte:head>

<div class="space-y-6">
	<div class="space-y-2">
		<h2 class="text-2xl font-semibold tracking-tight">Welcome back</h2>
		<p class="text-sm text-zinc-400">Choose your preferred login method</p>
	</div>

	{#if verifyAndLink}
		<div
			class="rounded-xl border border-violet-500/20 bg-violet-950/20 p-4 text-xs text-violet-300 backdrop-blur-md flex items-start gap-3"
		>
			<ShieldCheck class="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
			<div>
				<span class="font-bold text-white block mb-0.5">Connecting Social Account</span>
				Please sign in below. Once authenticated, we will securely link your profile.
			</div>
		</div>
	{/if}

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
				<span class="bg-surface-1 px-2 text-zinc-500">Or continue with</span>
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

				<div class="relative py-1">
					<div class="absolute inset-0 flex items-center">
						<div class="w-full border-t border-zinc-800/50"></div>
					</div>
					<div
						class="relative flex justify-center text-[10px] uppercase tracking-widest text-zinc-600"
					>
						<span class="bg-surface-1 px-2">or securely</span>
					</div>
				</div>

				<Button.Root
					variant="outline"
					class="w-full h-11 border-accent/20 bg-accent/5 hover:bg-accent/10 text-accent-hover font-medium transition-all"
					disabled={isLoading}
					onclick={handlePasskey}
				>
					<UserKey class="mr-2 h-4 w-4" />
					Sign in with Passkey
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
			class="group relative rounded-xl bg-purple-500/5 border border-purple-500/10 p-5 flex flex-col justify-between transition-all hover:bg-purple-500/8 hover:border-purple-500/20"
			transition:fade={{ duration: 150 }}
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
						Access your anonymous account using your unique 16-digit code.
					</p>
					<Input.Root
						type="password"
						placeholder="Account Code"
						class="h-10 border-zinc-800 bg-black/20 focus-visible:ring-purple-500 font-mono text-sm text-center"
						maxlength={16}
						bind:value={anonymousCode}
						disabled={isLoading}
					/>
				</div>
			</div>
			<Button.Root
				variant="outline"
				class="w-full h-10 mt-6 border-purple-500/20 bg-purple-500/5 hover:bg-purple-500/10 text-purple-300 font-medium transition-colors"
				disabled={isLoading || anonymousCode.length !== 16}
				onclick={handleAnonymousLogin}
			>
				Anonymous Login
			</Button.Root>
		</div>

		<div class="pt-4 text-center text-sm text-zinc-400" transition:fade={{ duration: 150 }}>
			Don't have an account?
			<a href="/register" class="text-accent hover:underline font-medium ml-1">Register now</a>
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
					>. Enter the 6-digit code below to authenticate.
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
					Confirm & Sign In
					<ArrowRight class="w-3.5 h-3.5" />
				</Button.Root>
			</div>
		</div>
	{/if}
</div>
