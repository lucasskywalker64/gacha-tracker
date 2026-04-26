<script lang="ts">
	import { authClient } from '$lib/api/auth';
	import { PUBLIC_FRONTEND_URL } from '$env/static/public';
	import { api } from '$lib/api/client';
	import * as Button from '$lib/components/ui/button';
	import * as Input from '$lib/components/ui/input';
	import * as Separator from '$lib/components/ui/separator';
	import { Mail, UserKey, Ghost, Loader2 } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth';

	let email = $state('');
	const isValidEmail = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
	let anonymousCode = $state('');
	let isLoading = $state(false);
	let errorMessage = $state('');

	async function handleSocialLogin(provider: 'discord' | 'google') {
		isLoading = true;
		errorMessage = '';
		try {
			await authClient.signIn.social({
				provider,
				callbackURL: PUBLIC_FRONTEND_URL
			});
		} catch (e) {
			console.error(e);
			errorMessage = 'Social login failed. Please try again.';
			isLoading = false;
		}
	}

	async function handleMagicLink() {
		if (!email) return;
		isLoading = true;
		errorMessage = '';
		try {
			await authClient.signIn.magicLink({
				email,
				callbackURL: PUBLIC_FRONTEND_URL
			});
			alert('Magic link sent! Check your email.');
		} catch (e) {
			console.error(e);
			errorMessage = 'Failed to send magic link.';
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
			const { error } = await api.api.auth.anonymous.login.post({ code: anonymousCode });
			if (error) {
				// @ts-expect-error - Eden Treaty error union might not contain .error.message
				errorMessage = error.value?.error?.message || 'Invalid code.';
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

	{#if errorMessage}
		<div class="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
			{errorMessage}
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-3">
		<Button.Root
			variant="outline"
			class="h-11 border-zinc-800 bg-surface-2 hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
			disabled={isLoading}
			onclick={() => handleSocialLogin('discord')}
		>
			<svg viewBox="0 0 24 24" class="h-4 w-4 fill-[#5865F2]" xmlns="http://www.w3.org/2000/svg">
				<path
					d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.086 2.157 2.419c0 1.334-.947 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.086 2.157 2.419c0 1.334-.946 2.419-2.157 2.419z"
				/>
			</svg>
			Discord
		</Button.Root>
		<Button.Root
			variant="outline"
			class="h-11 border-zinc-800 bg-surface-2 hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
			disabled={isLoading}
			onclick={() => handleSocialLogin('google')}
		>
			<svg viewBox="0 0 24 24" class="h-4 w-4" xmlns="http://www.w3.org/2000/svg">
				<path
					d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
					fill="#4285F4"
				/>
				<path
					d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
					fill="#34A853"
				/>
				<path
					d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.25.81-.59z"
					fill="#FBBC05"
				/>
				<path
					d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
					fill="#EA4335"
				/>
			</svg>
			Google
		</Button.Root>
	</div>

	<div class="relative py-2">
		<div class="absolute inset-0 flex items-center">
			<Separator.Root class="w-full bg-zinc-800" />
		</div>
		<div class="relative flex justify-center text-xs uppercase">
			<span class="bg-surface-1 px-2 text-zinc-500">Or continue with</span>
		</div>
	</div>

	<div class="space-y-4">
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
				onclick={handleMagicLink}
			>
				{#if isLoading}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
				{/if}
				Send Magic Link
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

	<div class="relative py-2">
		<div class="absolute inset-0 flex items-center">
			<Separator.Root class="w-full bg-zinc-800" />
		</div>
		<div class="relative flex justify-center text-xs uppercase">
			<span class="bg-surface-1 px-2 text-zinc-500">Privacy Mode</span>
		</div>
	</div>

	<!-- Anonymous Account Section -->
	<div
		class="group relative rounded-xl bg-purple-500/5 border border-purple-500/10 p-5 flex flex-col justify-between transition-all hover:bg-purple-500/8 hover:border-purple-500/20"
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

	<div class="pt-4 text-center text-sm text-zinc-400">
		Don't have an account?
		<a href="/register" class="text-accent hover:underline font-medium ml-1">Register now</a>
	</div>
</div>
