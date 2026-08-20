<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { api } from '$lib/api/client';
	import { authClient } from '$lib/api/auth';
	import { extractApiError } from '$lib/api/error';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import {
		LoaderCircle,
		Trash2,
		Download,
		Upload,
		TriangleAlert,
		ShieldCheck,
		Link2,
		Palette,
		Settings,
		Clock,
		CircleX,
		Gamepad2,
		Edit3,
		Crown,
		User
	} from 'lucide-svelte';
	import type { PageData } from './$types';
	import { fade, scale } from 'svelte/transition';
	import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte';
	import GoogleIcon from '$lib/components/icons/GoogleIcon.svelte';
	import { PUBLIC_API_URL } from '$env/static/public';
	import { inspectStarRailStationFile, type SrsProfileInfo } from '$lib/utils/srs-inspector';

	let { data }: { data: PageData } = $props();

	let settings = $state<PageData['settings'] | null>(null);
	let userGames = $state<PageData['userGames']>([]);
	let linkedAccounts = $state<Array<{ providerId: string }>>([]);
	let loadingAccounts = $state(true);

	// Editable fields
	let theme = $state<'system' | 'quantum-dark' | 'amber-dawn' | 'wobbly-waves'>('system');
	let originalTheme = $state<'system' | 'quantum-dark' | 'amber-dawn' | 'wobbly-waves'>('system');
	let pityDisplayMode = $state<'count_up' | 'count_down'>('count_up');

	// Sync local state when page data updates
	$effect(() => {
		if (data.settings) {
			settings = data.settings;
			theme =
				(data.settings.theme as 'system' | 'quantum-dark' | 'amber-dawn' | 'wobbly-waves') ||
				'system';
			originalTheme =
				(data.settings.theme as 'system' | 'quantum-dark' | 'amber-dawn' | 'wobbly-waves') ||
				'system';
			pityDisplayMode = (data.settings.pityDisplayMode as 'count_up' | 'count_down') || 'count_up';
		}
		if (data.userGames) {
			userGames = data.userGames;
		}
	});

	let activeTab = $state('account');
	let editingNicknames = $state<Record<string, string>>({});
	let editingState = $state<Record<string, boolean>>({});
	let updatingAccountMap = $state<Record<string, boolean>>({});

	let groupedGameAccounts = $derived.by(() => {
		const groups: Record<
			string,
			{
				gameId: string;
				gameDisplayName: string;
				gameIconUrl: string | null;
				accounts: Array<(typeof userGames)[0]>;
			}
		> = {};

		for (const ug of userGames) {
			if (!groups[ug.gameId]) {
				groups[ug.gameId] = {
					gameId: ug.gameId,
					gameDisplayName: (ug as { gameDisplayName?: string }).gameDisplayName || ug.gameId,
					gameIconUrl: (ug as { gameIconUrl?: string | null }).gameIconUrl || null,
					accounts: []
				};
			}
			groups[ug.gameId].accounts.push(ug);
		}

		return Object.values(groups);
	});

	async function setPrimaryAccount(gameId: string, gameUid: string) {
		const key = `${gameId}:${gameUid}`;
		updatingAccountMap[key] = true;
		try {
			const res = await api.games({ gameId }).accounts({ gameUid }).patch({
				isPrimary: true
			});
			if (res.error) {
				alert('Failed to set primary profile: ' + extractApiError(res.error, 'Error'));
				return;
			}
			if (res.data?.success) {
				const { data: updatedGames } = await api.user.games.get();
				if (updatedGames) {
					userGames = updatedGames;
				}
			}
		} catch (err) {
			alert(
				'Failed to set primary profile: ' + (err instanceof Error ? err.message : 'Network error')
			);
		} finally {
			updatingAccountMap[key] = false;
		}
	}

	async function saveAccountNickname(gameId: string, gameUid: string) {
		const key = `${gameId}:${gameUid}`;
		const nickname = editingNicknames[key] ?? '';
		updatingAccountMap[key] = true;
		try {
			const res = await api
				.games({ gameId })
				.accounts({ gameUid })
				.patch({
					nickname: nickname.trim() || null
				});
			if (res.error) {
				alert('Failed to save nickname: ' + extractApiError(res.error, 'Error'));
				return;
			}
			if (res.data?.success) {
				editingState[key] = false;
				const { data: updatedGames } = await api.user.games.get();
				if (updatedGames) {
					userGames = updatedGames;
				}
			}
		} catch (err) {
			alert('Failed to save nickname: ' + (err instanceof Error ? err.message : 'Network error'));
		} finally {
			updatingAccountMap[key] = false;
		}
	}

	let saving = $state(false);
	let settingsLoaderError = $state(false);
	let retrying = $state(false);

	let lastSeenLoaderError: boolean | undefined = undefined;
	$effect(() => {
		if (lastSeenLoaderError === undefined) {
			lastSeenLoaderError = data.settingsLoaderError;
		} else if (lastSeenLoaderError !== data.settingsLoaderError) {
			lastSeenLoaderError = data.settingsLoaderError;
			settingsLoaderError = data.settingsLoaderError;
		}
	});

	async function retryFetch() {
		retrying = true;
		try {
			const { data: fetchedSettings, error } = await api.user.settings.get();
			if (!error && fetchedSettings) {
				settings = fetchedSettings;
				theme =
					(fetchedSettings.theme as 'system' | 'quantum-dark' | 'amber-dawn' | 'wobbly-waves') ||
					'system';
				originalTheme =
					(fetchedSettings.theme as 'system' | 'quantum-dark' | 'amber-dawn' | 'wobbly-waves') ||
					'system';
				pityDisplayMode =
					(fetchedSettings.pityDisplayMode as 'count_up' | 'count_down') || 'count_up';
				settingsLoaderError = false;
				updateClientTheme(theme);
			} else {
				const errorMsg =
					error && typeof error === 'object' && 'value' in error
						? String((error as Record<string, unknown>).value)
						: String(error);
				alert('Failed to retrieve settings: ' + (errorMsg || 'Unknown error'));
			}
		} catch (err) {
			console.error('Failed to retry fetch:', err);
		} finally {
			retrying = false;
		}
	}

	// Multi-email state
	let authMethods = $state<{
		primaryEmail: string | null;
		secondaryEmails: Array<{
			email: string;
			verified: boolean;
			verifiedAt: string | null;
		}>;
		socialAccounts: Array<{ providerId: string }>;
		hasAnonymousCode: boolean;
		totalActiveCount: number;
	} | null>(null);
	let loadingAuthMethods = $state(true);

	let linkingEmailAddress = $state('');
	let linkingLoading = $state(false);
	let linkSuccessMessage = $state('');
	let linkErrorMessage = $state('');
	let unlinkingEmailMap = $state<Record<string, boolean>>({});
	let resendCooldowns = $state<Record<string, number>>({});

	let pendingOtpCodes = $state<Record<string, string>>({});
	let pendingOtpErrors = $state<Record<string, string>>({});
	let pendingOtpLoading = $state<Record<string, boolean>>({});

	let showUnlinkPrimaryModal = $state(false);
	let selectedEmailToPromote = $state('');
	let unlinkingPrimary = $state(false);
	let unlinkOtpCode = $state('');
	let unlinkOtpSending = $state(false);
	let unlinkOtpError = $state('');
	let unlinkOtpSuccess = $state('');
	let useSecondaryForUnlink = $state(false);
	let selectedSecondaryForUnlink = $state('');

	let eligibleSecondaries = $derived(
		authMethods?.secondaryEmails.filter((sec) => {
			if (!sec.verified || !sec.verifiedAt) return false;
			const verifiedTime = new Date(sec.verifiedAt).getTime();
			return Date.now() - verifiedTime >= 48 * 60 * 60 * 1000;
		}) || []
	);

	// Generic sensitive action OTP verification state
	let showSensitiveActionModal = $state(false);
	let sensitiveActionType = $state<
		'delete-game' | 'delete-profile' | 'unlink-secondary-email' | 'unlink-social' | ''
	>('');
	let sensitiveActionTarget = $state('');
	let sensitiveActionTargetName = $state('');
	let sensitiveActionCode = $state('');
	let sensitiveActionError = $state('');
	let sensitiveActionSuccess = $state('');
	let sensitiveActionSending = $state(false);
	let sensitiveActionVerifying = $state(false);
	let onSensitiveActionVerifiedCallback = $state<() => Promise<void> | void>();

	async function triggerSensitiveActionVerification(
		type: 'delete-game' | 'delete-profile' | 'unlink-secondary-email' | 'unlink-social',
		target: string,
		targetName: string,
		onVerified: () => Promise<void> | void
	) {
		sensitiveActionType = type;
		sensitiveActionTarget = target;
		sensitiveActionTargetName = targetName;
		sensitiveActionCode = '';
		sensitiveActionError = '';
		sensitiveActionSuccess = '';
		sensitiveActionSending = false;
		sensitiveActionVerifying = false;
		onSensitiveActionVerifiedCallback = onVerified;

		showSensitiveActionModal = true;
	}

	async function sendSensitiveActionOtp() {
		if (sensitiveActionSending) return;
		sensitiveActionSending = true;
		sensitiveActionError = '';
		sensitiveActionSuccess = '';
		try {
			const { error } = await api.user['sensitive-action-otp'].post({
				action: sensitiveActionType as
					| 'delete-game'
					| 'delete-profile'
					| 'unlink-secondary-email'
					| 'unlink-social',
				target: sensitiveActionTarget || undefined
			});
			if (error) {
				sensitiveActionError = extractApiError(error, 'Failed to send verification code.');
			} else {
				sensitiveActionSuccess = `A 6-digit verification code has been sent to ${authMethods?.primaryEmail}.`;
			}
		} catch (err) {
			console.error(err);
			sensitiveActionError = 'An unexpected error occurred.';
		} finally {
			sensitiveActionSending = false;
		}
	}

	async function confirmSensitiveAction() {
		if (sensitiveActionVerifying) return;
		sensitiveActionVerifying = true;
		sensitiveActionError = '';
		try {
			const isPrimaryAnonymous =
				authMethods?.primaryEmail?.endsWith('@anon.gacha-tracker.app') ?? false;

			if (isPrimaryAnonymous) {
				if (onSensitiveActionVerifiedCallback) {
					await onSensitiveActionVerifiedCallback();
				}
				showSensitiveActionModal = false;
			} else {
				const { error } = await api.user['verify-sensitive-action'].post({
					action: sensitiveActionType as
						| 'delete-game'
						| 'delete-profile'
						| 'unlink-secondary-email'
						| 'unlink-social',
					target: sensitiveActionTarget || undefined,
					code: sensitiveActionCode
				});

				if (error) {
					sensitiveActionError = extractApiError(
						error,
						'Verification failed. Please verify the code and try again.'
					);
				} else {
					if (onSensitiveActionVerifiedCallback) {
						await onSensitiveActionVerifiedCallback();
					}
					showSensitiveActionModal = false;
				}
			}
		} catch (err) {
			console.error(err);
			sensitiveActionError = 'An unexpected error occurred.';
		} finally {
			sensitiveActionVerifying = false;
		}
	}

	async function fetchAuthMethods() {
		loadingAuthMethods = true;
		try {
			const { data, error } = await api.user['auth-methods'].get();
			if (!error && data) {
				authMethods = data;
			}
		} catch (err) {
			console.error('Failed to fetch auth methods:', err);
		} finally {
			loadingAuthMethods = false;
		}
	}

	async function linkEmail(e: SubmitEvent) {
		e.preventDefault();
		if (!linkingEmailAddress || linkingLoading) return;

		linkingLoading = true;
		linkSuccessMessage = '';
		linkErrorMessage = '';

		try {
			const { error } = await api.user['link-email'].post({ email: linkingEmailAddress });
			if (error) {
				linkErrorMessage = extractApiError(
					error,
					'Failed to link email address. Please try again.'
				);
			} else {
				linkSuccessMessage = `A 6-digit verification code has been sent to ${linkingEmailAddress}.`;
				linkingEmailAddress = '';
				await fetchAuthMethods();
			}
		} catch (err) {
			console.error('Failed to link email:', err);
			linkErrorMessage = 'An unexpected error occurred.';
		} finally {
			linkingLoading = false;
		}
	}

	async function verifyPendingEmail(email: string) {
		const code = pendingOtpCodes[email];
		if (!code || pendingOtpLoading[email]) return;

		pendingOtpLoading[email] = true;
		pendingOtpErrors[email] = '';

		try {
			const { data, error } = await api.user['link-email'].verify.post({
				email,
				code
			});
			if (error) {
				pendingOtpErrors[email] = extractApiError(
					error,
					'Verification failed. Please verify the code and try again.'
				);
			} else {
				if (data?.promoted) {
					alert('Email address verified and successfully promoted to your primary login email!');
					window.location.reload();
				} else {
					alert('Email address verified and linked successfully!');
					delete pendingOtpCodes[email];
					delete pendingOtpErrors[email];
					await fetchAuthMethods();
				}
			}
		} catch (err) {
			console.error('Failed to verify linked email:', err);
			pendingOtpErrors[email] = 'An unexpected error occurred.';
		} finally {
			pendingOtpLoading[email] = false;
		}
	}

	async function sendUnlinkEmailOtp() {
		if (unlinkOtpSending) return;
		unlinkOtpSending = true;
		unlinkOtpError = '';
		unlinkOtpSuccess = '';
		try {
			const useSecondary = useSecondaryForUnlink && selectedSecondaryForUnlink;
			const { error } = await api.user['unlink-email-otp'].post(
				useSecondary ? { useSecondaryEmail: selectedSecondaryForUnlink } : undefined
			);
			if (error) {
				unlinkOtpError = extractApiError(error, 'Failed to send verification code.');
			} else {
				unlinkOtpSuccess = `A 6-digit verification code has been sent to ${
					useSecondary ? selectedSecondaryForUnlink : authMethods?.primaryEmail
				}.`;
			}
		} catch (err) {
			console.error('Failed to send unlink email OTP:', err);
			unlinkOtpError = 'An unexpected error occurred.';
		} finally {
			unlinkOtpSending = false;
		}
	}

	async function unlinkAnyEmail(email: string, isPrimary: boolean) {
		const isSecondaryVerified = authMethods?.secondaryEmails.find(
			(e) => e.email.toLowerCase() === email.toLowerCase()
		)?.verified;

		if (isPrimary) {
			const verifiedSecondaries = authMethods?.secondaryEmails.filter((e) => e.verified) || [];
			if (verifiedSecondaries.length === 0) {
				alert(
					'Safety Error: You must link and verify a secondary email address before you can remove your primary email.'
				);
				return;
			}
			selectedEmailToPromote = verifiedSecondaries[0].email;

			// Reset OTP states
			unlinkOtpCode = '';
			unlinkOtpError = '';
			unlinkOtpSuccess = '';
			useSecondaryForUnlink = false;
			selectedSecondaryForUnlink = verifiedSecondaries[0].email;

			showUnlinkPrimaryModal = true;
			return;
		}

		if (!isSecondaryVerified) {
			unlinkingEmailMap[email] = true;
			try {
				const res = await api.user['unlink-secondary-email'].post({ email });
				const error = res.error;

				if (error) {
					alert(
						'Failed to remove email: ' +
							extractApiError(error, String((error as { value?: unknown })?.value || error))
					);
				} else {
					await fetchAuthMethods();
				}
			} catch (err) {
				console.error('Failed to remove email:', err);
			} finally {
				unlinkingEmailMap[email] = false;
			}
			return;
		}

		await triggerSensitiveActionVerification('unlink-secondary-email', email, email, async () => {
			unlinkingEmailMap[email] = true;
			try {
				const res = await api.user['unlink-secondary-email'].post({ email });
				const error = res.error;

				if (error) {
					alert(
						'Failed to remove email: ' +
							extractApiError(error, String((error as { value?: unknown })?.value || error))
					);
				} else {
					await fetchAuthMethods();
				}
			} catch (err) {
				console.error('Failed to remove email:', err);
			} finally {
				unlinkingEmailMap[email] = false;
			}
		});
	}

	async function confirmUnlinkPrimary() {
		if (unlinkingPrimary) return;
		unlinkingPrimary = true;
		unlinkOtpError = '';
		try {
			const isPrimaryAnonymous =
				authMethods?.primaryEmail?.endsWith('@anon.gacha-tracker.app') ?? false;
			const { error } = await api.user['unlink-email'].post({
				emailToPromote: selectedEmailToPromote || undefined,
				code: isPrimaryAnonymous ? undefined : unlinkOtpCode
			});
			if (error) {
				unlinkOtpError = extractApiError(
					error,
					String((error as { value?: unknown })?.value || error)
				);
			} else {
				window.location.reload();
			}
		} catch (err) {
			console.error('Failed to remove email:', err);
			unlinkOtpError = 'An unexpected error occurred.';
		} finally {
			unlinkingPrimary = false;
		}
	}

	function toggleLostAccess() {
		useSecondaryForUnlink = !useSecondaryForUnlink;
		unlinkOtpCode = '';
		unlinkOtpSuccess = '';
		unlinkOtpError = '';
		if (useSecondaryForUnlink) {
			if (eligibleSecondaries.length > 0) {
				selectedSecondaryForUnlink = eligibleSecondaries[0].email;
				selectedEmailToPromote = eligibleSecondaries[0].email;
			} else {
				selectedSecondaryForUnlink = '';
			}
		} else {
			const verifiedSecondaries = authMethods?.secondaryEmails?.filter((e) => e.verified) || [];
			if (verifiedSecondaries.length > 0) {
				selectedEmailToPromote = verifiedSecondaries[0].email;
			}
		}
	}

	const activeIntervals: Record<string, ReturnType<typeof setInterval>> = {};

	function startCooldownTimer(email: string, secondsRemaining: number) {
		if (activeIntervals[email]) {
			clearInterval(activeIntervals[email]);
		}
		resendCooldowns[email] = secondsRemaining;
		activeIntervals[email] = setInterval(() => {
			if (resendCooldowns[email] > 0) {
				resendCooldowns[email]--;
			} else {
				clearInterval(activeIntervals[email]);
				delete activeIntervals[email];
				try {
					sessionStorage.removeItem(`resend_cooldown:${email}`);
				} catch (e) {
					console.error('Failed to remove cooldown from sessionStorage:', e);
				}
			}
		}, 1000);
	}

	async function resendVerification(email: string) {
		if (resendCooldowns[email] > 0) return;

		const cooldownDuration = 60;
		const deadline = Date.now() + cooldownDuration * 1000;
		try {
			sessionStorage.setItem(`resend_cooldown:${email}`, deadline.toString());
		} catch (e) {
			console.error('Failed to set cooldown in sessionStorage:', e);
		}

		startCooldownTimer(email, cooldownDuration);

		try {
			const { error } = await api.user['link-email'].post({ email });
			if (error) {
				alert(
					'Failed to resend: ' +
						extractApiError(error, String((error as { value?: unknown })?.value || error))
				);
			} else {
				alert(`Verification code successfully resent to ${email}!`);
			}
		} catch (err) {
			console.error(err);
		}
	}

	onMount(async () => {
		// Restore active cooldowns from sessionStorage
		try {
			const keysToProcess: string[] = [];
			for (let i = 0; i < sessionStorage.length; i++) {
				const key = sessionStorage.key(i);
				if (key && key.startsWith('resend_cooldown:')) {
					keysToProcess.push(key);
				}
			}
			for (const key of keysToProcess) {
				const email = key.substring('resend_cooldown:'.length);
				const deadlineStr = sessionStorage.getItem(key);
				if (deadlineStr) {
					const deadline = parseInt(deadlineStr, 10);
					const now = Date.now();
					if (deadline > now) {
						const secondsRemaining = Math.ceil((deadline - now) / 1000);
						startCooldownTimer(email, secondsRemaining);
					} else {
						sessionStorage.removeItem(key);
					}
				}
			}
		} catch (e) {
			console.error('Failed to restore resend cooldowns:', e);
		}

		await Promise.all([fetchLinkedAccounts(), fetchAuthMethods()]);

		// Check for URL linking status query parameters
		const urlParams = new URLSearchParams(window.location.search);

		// Check for social re-authentication success callback
		const reauthSuccess = urlParams.get('reauth_success');
		const reauthProvider = urlParams.get('provider');

		// Handle pending social re-authentication cleanup and check
		try {
			const pendingReauthProvider = sessionStorage.getItem('pending_social_reauth');
			if (pendingReauthProvider) {
				sessionStorage.removeItem('pending_social_reauth');
				if (reauthSuccess !== 'true' || reauthProvider !== pendingReauthProvider) {
					alert(
						`Re-authentication with ${pendingReauthProvider === 'google' ? 'Google' : 'Discord'} was cancelled or failed.`
					);
				}
			}
		} catch (e) {
			console.error('Failed to handle pending social reauth check:', e);
		}

		if (reauthSuccess === 'true' && reauthProvider) {
			// Wipe reauth parameters immediately from the browser address bar
			const newUrl = new URL(window.location.href);
			newUrl.searchParams.delete('reauth_success');
			newUrl.searchParams.delete('provider');
			window.history.replaceState({}, document.title, newUrl.pathname + newUrl.search);

			try {
				const { error } = await api.user.delete({
					type: 'social',
					provider: reauthProvider
				});
				if (!error) {
					await authClient.signOut();
					window.location.href = '/login';
				} else {
					alert(
						'Failed to delete account: ' +
							extractApiError(error, 'Verification failed. Please try again.')
					);
				}
			} catch (err) {
				console.error('Failed to process social deletion:', err);
				alert('An unexpected error occurred during account deletion.');
			}
		}
	});

	onDestroy(() => {
		// Revert client-side theme preview to original saved theme if navigated away without saving
		if (settings) {
			updateClientTheme(originalTheme);
		}
		// Clear all active cooldown intervals
		for (const email of Object.keys(activeIntervals)) {
			clearInterval(activeIntervals[email]);
		}
	});

	async function fetchLinkedAccounts() {
		loadingAccounts = true;
		try {
			const { data, error } = await authClient.listAccounts();
			if (!error && data) {
				linkedAccounts = data;
			} else {
				linkedAccounts = [];
			}
		} catch (err) {
			console.error('Failed to load linked accounts:', err);
		} finally {
			loadingAccounts = false;
		}
	}

	async function savePreferences() {
		saving = true;
		try {
			const { error } = await api.user.settings.patch({
				theme,
				pityDisplayMode
			});
			if (!error && settings) {
				settings = {
					...settings,
					theme,
					pityDisplayMode
				};
				originalTheme = theme; // Persist the theme choice as the original reference
				updateClientTheme(theme);
				alert('Preferences saved successfully.');
			} else if (error) {
				alert('Failed to save settings: ' + error.value);
			}
		} catch (err) {
			console.error('Failed to save settings:', err);
		} finally {
			saving = false;
		}
	}

	function updateClientTheme(selectedTheme: string) {
		const root = window.document.documentElement;
		root.classList.remove('theme-quantum-dark', 'theme-amber-dawn', 'theme-wobbly-waves');
		if (selectedTheme !== 'system' && selectedTheme !== 'light') {
			root.classList.add(`theme-${selectedTheme}`);
		}
	}

	async function linkProvider(provider: 'discord' | 'google') {
		try {
			try {
				sessionStorage.setItem('pending_link_provider', provider);
			} catch (e) {
				console.error('Failed to set pending_link_provider in sessionStorage:', e);
			}
			await authClient.linkSocial({
				provider,
				callbackURL: window.location.origin + '/settings',
				errorCallbackURL: window.location.origin + '/auth/callback'
			});
		} catch (err) {
			console.error(`Failed to link ${provider}:`, err);
		}
	}

	async function unlinkProvider(providerId: string) {
		await triggerSensitiveActionVerification('unlink-social', providerId, providerId, async () => {
			const res = await authClient.unlinkAccount({
				providerId
			});
			if (res.error) {
				alert('Failed to unlink: ' + res.error.message);
			} else {
				await fetchLinkedAccounts();
				await fetchAuthMethods();
				alert(`${providerId} unlinked successfully.`);
			}
		});
	}

	async function exportData() {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/pulls/export`, {
				credentials: 'include'
			});
			if (!res.ok) throw new Error('Export failed');
			const blob = await res.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `gacha-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);
		} catch (err) {
			console.error(err);
			alert('Failed to export data.');
		}
	}

	// Data Management
	let formats = $state<Array<{ id: string; displayName: string; acceptedExtensions: string }>>([]);
	let loadingFormats = $state(true);

	let selectedFormat = $state('gacha-tracker');
	let gameUid = $state('');
	let srsSingleUid = $state('');
	let srsProfiles = $state<SrsProfileInfo[]>([]);
	let srsProfileUids = $state<Record<string, string>>({});
	let inspectingSrs = $state(false);

	let selectedFormatObj = $derived(formats.find((f) => f.id === selectedFormat));
	let acceptedExtensions = $derived(selectedFormatObj?.acceptedExtensions || '.json');
	let importFile = $state<File | null>(null);
	let fileInputRef = $state<HTMLInputElement | null>(null);
	let importing = $state(false);
	let importError = $state('');
	let importSuccess = $state<
		| { gameId: string; gameUid: string; imported: number; message: string; success: boolean }[]
		| null
	>(null);

	let srsInspectionVersion = 0;

	async function updateSrsInspection(file: File | null) {
		const version = ++srsInspectionVersion;
		if (!file || selectedFormat !== 'starrail-station') {
			inspectingSrs = false;
			srsProfiles = [];
			srsProfileUids = {};
			srsSingleUid = '';
			return;
		}

		inspectingSrs = true;
		srsProfiles = [];
		srsProfileUids = {};
		srsSingleUid = '';
		try {
			const res = await inspectStarRailStationFile(file);
			if (
				version !== srsInspectionVersion ||
				file !== importFile ||
				selectedFormat !== 'starrail-station'
			) {
				return;
			}
			srsProfiles = res.profiles;
			if (res.profiles.length > 0) {
				const initialUids: Record<string, string> = {};
				for (const p of res.profiles) {
					initialUids[p.key] = srsProfileUids[p.key] || srsSingleUid;
				}
				srsProfileUids = initialUids;
			} else {
				srsProfileUids = {};
			}
		} finally {
			if (version === srsInspectionVersion) {
				inspectingSrs = false;
			}
		}
	}

	$effect(() => {
		if (selectedFormat !== 'starrail-station') {
			srsInspectionVersion++;
			inspectingSrs = false;
			srsProfiles = [];
			srsProfileUids = {};
			srsSingleUid = '';
		} else if (importFile) {
			updateSrsInspection(importFile);
		}
	});

	// Cooldown states
	let _cooldownExpiresAt = $state<number | null>(null); // Unix ms
	let cooldownRemaining = $state(0); // seconds remaining

	// Queue states
	let pendingRequestId = $state<string | null>(null);
	let queueStatus = $state<'queued' | 'processing' | 'done' | 'failed' | 'cancelled' | null>(null);
	let queuePosition = $state<number | null>(null);
	let queueWaitedSeconds = $state(0);

	let countdownInterval: ReturnType<typeof setInterval> | null = null;

	function clearLocalStorage() {
		localStorage.removeItem('gt_import_state');
	}

	function saveToLocalStorage(requestId: string, expiresAt: number) {
		localStorage.setItem(
			'gt_import_state',
			JSON.stringify({
				requestId,
				cooldownExpiresAt: expiresAt
			})
		);
	}

	let pollTimeout: ReturnType<typeof setTimeout> | null = null;
	let currentPollDelay = 1000;

	function saveSummaryToLocalStorage(
		summary: Array<{
			gameId: string;
			gameUid: string;
			imported: number;
			message: string;
			success: boolean;
		}>
	) {
		try {
			localStorage.setItem('gt_last_import_summary', JSON.stringify(summary));
		} catch (e) {
			console.error('Failed to save import summary to localStorage:', e);
		}
	}

	function clearSummaryFromLocalStorage() {
		try {
			localStorage.removeItem('gt_last_import_summary');
		} catch (e) {
			console.error('Failed to clear import summary from localStorage:', e);
		}
	}

	function dismissImportSummary() {
		importSuccess = null;
		clearSummaryFromLocalStorage();
	}

	function stopPolling() {
		if (pollTimeout) {
			clearTimeout(pollTimeout);
			pollTimeout = null;
		}
	}

	function stopCountdown() {
		if (countdownInterval) {
			clearInterval(countdownInterval);
			countdownInterval = null;
		}
	}

	function startCooldownCountdown(expiresAt: number) {
		stopCountdown();
		_cooldownExpiresAt = expiresAt;
		cooldownRemaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));

		countdownInterval = setInterval(() => {
			const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
			cooldownRemaining = remaining;
			if (remaining === 0) {
				stopCountdown();
				_cooldownExpiresAt = null;
			}
		}, 500);
	}

	function startPolling(requestId: string) {
		stopPolling();
		pendingRequestId = requestId;
		importing = true;
		currentPollDelay = 1000;

		async function pollStep() {
			if (!pendingRequestId || pendingRequestId !== requestId) return;

			try {
				const res = await fetch(`${PUBLIC_API_URL}/pulls/import/status/${requestId}`, {
					credentials: 'include'
				});
				if (!res.ok) {
					stopPolling();
					importing = false;
					if (res.status === 404) {
						importError = 'Import request expired or not found.';
					} else {
						importError = `Failed to get import status (${res.status})`;
					}
					clearLocalStorage();
					pendingRequestId = null;
					queueStatus = null;
					return;
				}

				const data = await res.json();
				queueStatus = data.status;
				queuePosition = data.position;
				queueWaitedSeconds = data.waitedSeconds;

				if (data.status === 'done') {
					importSuccess = data.result.summary;
					saveSummaryToLocalStorage(data.result.summary);
					importFile = null;
					if (fileInputRef) {
						fileInputRef.value = '';
					}
					clearLocalStorage();
					stopPolling();
					importing = false;
					pendingRequestId = null;
					queueStatus = null;
				} else if (data.status === 'failed') {
					importError = data.error || 'Import failed.';
					clearLocalStorage();
					stopPolling();
					importing = false;
					pendingRequestId = null;
					queueStatus = null;
				} else if (data.status === 'cancelled') {
					importError = 'Import request cancelled.';
					clearLocalStorage();
					stopPolling();
					importing = false;
					pendingRequestId = null;
					queueStatus = null;
				} else if (data.status === 'expired') {
					importError = data.error || 'Import task result expired.';
					clearLocalStorage();
					stopPolling();
					importing = false;
					pendingRequestId = null;
					queueStatus = null;
				} else {
					const nextDelay = data.position && data.position > 1 ? 5000 : 1000;
					currentPollDelay = nextDelay;
					pollTimeout = setTimeout(pollStep, nextDelay);
				}
			} catch (err) {
				console.error('Polling error:', err);
				currentPollDelay = Math.min(10000, currentPollDelay * 2);
				pollTimeout = setTimeout(pollStep, currentPollDelay);
			}
		}

		pollTimeout = setTimeout(pollStep, 1000);
	}

	async function handleCancelQueue() {
		if (!pendingRequestId) return;
		try {
			const res = await fetch(`${PUBLIC_API_URL}/pulls/import/queue/${pendingRequestId}`, {
				method: 'DELETE',
				credentials: 'include'
			});
			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				importError = errData.error || 'Failed to cancel request.';
				return;
			}
			stopPolling();
			clearLocalStorage();
			queueStatus = null;
			pendingRequestId = null;
			importing = false;
			importError = 'Import cancelled.';
		} catch (err) {
			console.error('Cancel error:', err);
		}
	}

	let importStatusSummary = $derived.by(() => {
		if (!importSuccess || importSuccess.length === 0) return null;
		const total = importSuccess.length;
		const successes = importSuccess.filter((s) => s.success).length;
		if (successes === total) {
			return {
				title: 'Import Completed Successfully',
				bgClass: 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400',
				titleClass: 'text-emerald-400'
			};
		} else if (successes === 0) {
			return {
				title: 'Import Failed',
				bgClass: 'bg-red-500/5 border-red-500/20 text-red-400',
				titleClass: 'text-red-400'
			};
		} else {
			return {
				title: 'Import Complete with Warnings',
				bgClass: 'bg-amber-500/5 border-amber-500/20 text-amber-400',
				titleClass: 'text-amber-400'
			};
		}
	});

	onMount(async () => {
		try {
			const savedSummary = localStorage.getItem('gt_last_import_summary');
			if (savedSummary) {
				importSuccess = JSON.parse(savedSummary);
			}
		} catch (e) {
			console.error('Failed to restore import summary:', e);
		}

		try {
			const saved = localStorage.getItem('gt_import_state');
			if (saved) {
				const state = JSON.parse(saved);
				if (state.cooldownExpiresAt && state.cooldownExpiresAt > Date.now()) {
					startCooldownCountdown(state.cooldownExpiresAt);
				}
				if (state.requestId) {
					startPolling(state.requestId);
				}
			}
		} catch (e) {
			console.error('Failed to restore import state:', e);
		}

		try {
			const { data: res } = await api.pulls.import.formats.get();
			if (res?.formats) {
				formats = res.formats;
			}
		} catch (err) {
			console.error('Failed to load import formats:', err);
		} finally {
			loadingFormats = false;
		}
	});

	onDestroy(() => {
		stopPolling();
		stopCountdown();
	});

	function formatExtensionsList(extensions: string): string {
		return extensions
			.split(',')
			.map((ext) => ext.trim().replace(/^\./, '').toUpperCase())
			.join(', ');
	}

	function validateImportFile(file: File): { isValid: boolean; error: string } {
		// Validate file type/extension
		const allowedList = acceptedExtensions
			.toLowerCase()
			.split(',')
			.map((ext) => ext.trim());
		const fileName = file.name.toLowerCase();
		const isValidExt = allowedList.some((ext) => fileName.endsWith(ext));

		if (!isValidExt) {
			return {
				isValid: false,
				error: `Invalid file type. Expected ${formatExtensionsList(acceptedExtensions)} format.`
			};
		}

		// Validate file size (Max 5MB)
		if (file.size > 5 * 1024 * 1024) {
			return {
				isValid: false,
				error: 'File size exceeds the 5MB limit.'
			};
		}

		return { isValid: true, error: '' };
	}

	function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = target.files[0];
			const validation = validateImportFile(file);
			if (!validation.isValid) {
				importError = validation.error;
				importFile = null;
				srsProfiles = [];
				srsProfileUids = {};
				target.value = '';
				return;
			}
			importFile = file;
			importError = '';
			importSuccess = null;
		}
	}

	async function handleImport() {
		if (!importFile || importing || inspectingSrs) return;

		const validation = validateImportFile(importFile);
		if (!validation.isValid) {
			importError = validation.error;
			return;
		}

		if (selectedFormat === 'paimon-moe') {
			const cleanUid = gameUid.trim();
			if (!cleanUid) {
				importError = 'Please enter your Genshin Impact UID.';
				return;
			}
			if (!/^\d{9,10}$/.test(cleanUid)) {
				importError = 'Invalid Genshin Impact UID. A standard UID is 9 or 10 digits.';
				return;
			}
		}

		if (selectedFormat === 'starrail-station') {
			if (srsProfiles.length > 1) {
				const seenUids: string[] = [];
				for (const p of srsProfiles) {
					const uid = srsProfileUids[p.key]?.trim() || '';
					if (!uid) {
						importError = `Please enter a UID for profile "${p.name}".`;
						return;
					}
					if (!/^\d{9}$/.test(uid)) {
						importError = `Invalid Honkai: Star Rail UID for profile "${p.name}". A standard UID is 9 digits.`;
						return;
					}
					if (seenUids.includes(uid)) {
						importError = `Duplicate UID "${uid}" detected. Each profile must map to a distinct in-game account.`;
						return;
					}
					seenUids.push(uid);
				}
			} else {
				const cleanUid = srsSingleUid.trim();
				if (!cleanUid) {
					importError = 'Please enter your Honkai: Star Rail UID.';
					return;
				}
				if (!/^\d{9}$/.test(cleanUid)) {
					importError = 'Invalid Honkai: Star Rail UID. A standard UID is 9 digits.';
					return;
				}
			}
		}

		importing = true;
		importError = '';
		importSuccess = null;
		clearSummaryFromLocalStorage();

		try {
			const formData = new FormData();
			formData.append('format', selectedFormat);
			formData.append('file', importFile);
			if (selectedFormat === 'paimon-moe') {
				formData.append('gameUid', gameUid.trim());
			} else if (selectedFormat === 'starrail-station') {
				if (srsProfiles.length > 1) {
					formData.append('profileUids', JSON.stringify(srsProfileUids));
				} else {
					formData.append('gameUid', srsSingleUid.trim());
					if (srsProfiles.length === 1) {
						formData.append(
							'profileUids',
							JSON.stringify({ [srsProfiles[0].key]: srsSingleUid.trim() })
						);
					}
				}
			}

			const res = await fetch(`${PUBLIC_API_URL}/pulls/import/file`, {
				method: 'POST',
				credentials: 'include',
				body: formData
			});

			if (res.status === 202) {
				const result = await res.json();
				const expiresAt = Date.parse(result.cooldownExpiresAt);
				saveToLocalStorage(result.requestId, expiresAt);
				startCooldownCountdown(expiresAt);
				startPolling(result.requestId);
			} else if (res.status === 429) {
				const errorData = await res.json();
				const retryAfter = errorData.retryAfter || 60;
				const expiresAt = Date.now() + retryAfter * 1000;
				startCooldownCountdown(expiresAt);
				throw new Error(errorData.error || 'Too many requests. Cooldown active.');
			} else if (res.status === 503) {
				const errorData = await res.json();
				throw new Error(errorData.error || 'The import queue is full.');
			} else if (!res.ok) {
				let errorMsg = `Import failed (${res.status})`;
				try {
					const errorData = await res.json();
					if (errorData?.error) {
						errorMsg = errorData.error;
					}
				} catch {
					// Fallback if not JSON or empty
				}
				throw new Error(errorMsg);
			} else {
				const result = await res.json();
				importSuccess = result.summary;
				importFile = null;
				srsSingleUid = '';
				srsProfileUids = {};
				srsProfiles = [];
				if (fileInputRef) {
					fileInputRef.value = '';
				}
				importing = false;
			}
		} catch (err) {
			console.error(err);
			const message = err instanceof Error ? err.message : String(err);
			importError = message || 'An unexpected error occurred during import.';
			importing = false;
		}
	}

	async function purgeGameData(gameId: string, gameName: string) {
		await triggerSensitiveActionVerification('delete-game', gameId, gameName, async () => {
			const isPrimaryAnonymous =
				authMethods?.primaryEmail?.endsWith('@anon.gacha-tracker.app') ?? false;
			const payload = isPrimaryAnonymous ? { code: sensitiveActionCode } : undefined;
			const { error } = await api.user.game({ gameId }).delete(payload);
			if (!error) {
				alert(`Data for ${gameName} has been purged.`);
				userGames = userGames.filter((ug: { gameId: string }) => ug.gameId !== gameId);
			} else {
				alert('Failed to purge: ' + extractApiError(error, 'Error'));
			}
		});
	}

	async function purgeProfileData(gameId: string, gameUid: string, profileLabel: string) {
		await triggerSensitiveActionVerification(
			'delete-profile',
			`${gameId}:${gameUid}`,
			profileLabel,
			async () => {
				const isPrimaryAnonymous =
					authMethods?.primaryEmail?.endsWith('@anon.gacha-tracker.app') ?? false;
				const payload = isPrimaryAnonymous ? { code: sensitiveActionCode } : undefined;
				const { error } = await api.games({ gameId }).accounts({ gameUid }).delete(payload);
				if (!error) {
					alert(`Data for profile "${profileLabel}" has been purged.`);
					const { data: updatedGames } = await api.user.games.get();
					if (updatedGames) {
						userGames = updatedGames;
					}
				} else {
					alert('Failed to purge profile: ' + extractApiError(error, 'Error'));
				}
			}
		);
	}

	let showDeleteModal = $state(false);
	let deleteStep = $state<'otp' | 'anonymous'>('otp');
	let deleteAnonCode = $state('');
	let deleteSelectedEmail = $state('');
	let deleteOtpCode = $state('');
	let deleteOtpSending = $state(false);
	let deleteOtpError = $state('');
	let deleteOtpSuccess = $state('');
	let deletingAccount = $state(false);
	let deleteErrorMessage = $state('');

	function deleteAccount() {
		deleteAnonCode = '';
		deleteSelectedEmail = authMethods?.primaryEmail || '';
		deleteOtpCode = '';
		deleteOtpError = '';
		deleteOtpSuccess = '';
		deleteErrorMessage = '';
		deletingAccount = false;

		if (authMethods?.hasAnonymousCode) {
			deleteStep = 'anonymous';
		} else {
			deleteStep = 'otp';
		}
		showDeleteModal = true;
	}

	async function sendDeleteOtp() {
		if (!deleteSelectedEmail || deleteOtpSending) return;
		deleteOtpSending = true;
		deleteOtpError = '';
		deleteOtpSuccess = '';
		try {
			const { error } = await api.user['delete-otp'].post({ email: deleteSelectedEmail });
			if (error) {
				deleteOtpError = extractApiError(error, 'Failed to send verification code.');
			} else {
				deleteOtpSuccess = `A 6-digit verification code has been sent to ${deleteSelectedEmail}.`;
			}
		} catch (err) {
			console.error(err);
			deleteOtpError = 'An unexpected error occurred.';
		} finally {
			deleteOtpSending = false;
		}
	}

	async function confirmDeleteAccount() {
		if (deletingAccount) return;
		deletingAccount = true;
		deleteErrorMessage = '';
		try {
			let payload;
			if (deleteStep === 'anonymous') {
				payload = { type: 'anonymous' as const, code: deleteAnonCode };
			} else if (deleteStep === 'otp') {
				payload = { type: 'email' as const, email: deleteSelectedEmail, code: deleteOtpCode };
			} else {
				return;
			}

			const { error } = await api.user.delete(payload);
			if (!error) {
				await authClient.signOut();
				window.location.href = '/login';
			} else {
				deleteErrorMessage = extractApiError(
					error,
					'Deletion failed. Please verify the code and try again.'
				);
			}
		} catch (err) {
			console.error(err);
			deleteErrorMessage = 'An unexpected error occurred.';
		} finally {
			deletingAccount = false;
		}
	}
</script>

<div class="max-w-4xl mx-auto space-y-8 p-6 lg:p-10">
	<!-- Heading Section -->
	<div class="flex items-center gap-4">
		<div
			class="w-12 h-12 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-violet-500"
		>
			<Settings class="w-6 h-6 animate-pulse" />
		</div>
		<div>
			<h1 class="text-3xl font-black tracking-tight text-white">Settings</h1>
			<p class="text-zinc-500 text-sm mt-1">
				Manage your connected login providers, design aesthetics, and data privacy.
			</p>
		</div>
	</div>

	<Tabs.Root bind:value={activeTab} class="w-full">
		<Tabs.List
			class="grid h-auto w-full grid-cols-4 bg-zinc-900/50 border border-zinc-800 rounded-xl p-1 mb-6"
		>
			<Tabs.Trigger
				value="account"
				class="rounded-lg text-sm font-semibold text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-white cursor-pointer py-2"
			>
				Account
			</Tabs.Trigger>
			<Tabs.Trigger
				value="preferences"
				class="rounded-lg text-sm font-semibold text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-white cursor-pointer py-2"
			>
				Preferences
			</Tabs.Trigger>
			<Tabs.Trigger
				value="data"
				class="rounded-lg text-sm font-semibold text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-white cursor-pointer py-2"
			>
				Data Management
			</Tabs.Trigger>
			<Tabs.Trigger
				value="danger"
				class="rounded-lg text-sm font-semibold text-red-400/80 data-[state=active]:bg-red-950/20 data-[state=active]:text-red-400 cursor-pointer py-2"
			>
				Danger Zone
			</Tabs.Trigger>
		</Tabs.List>

		<!-- 1. ACCOUNT PANEL -->
		<Tabs.Content value="account" class="space-y-6 outline-none">
			<!-- Account Details & Linked Providers -->
			<Card.Root
				class="bg-zinc-950/60 backdrop-blur-xl border-zinc-800 rounded-2xl overflow-hidden shadow-xl shadow-black/30 p-0 gap-0"
			>
				<Card.Header
					class="bg-linear-to-b from-zinc-900/50 to-transparent p-6 border-b border-zinc-900"
				>
					<div class="flex items-center gap-3">
						<ShieldCheck class="w-5 h-5 text-violet-400" />
						<Card.Title class="text-white text-lg font-bold">Account & Security</Card.Title>
					</div>
					<Card.Description class="text-zinc-500 mt-1"
						>View active identity and manage connected OAuth/social login providers.</Card.Description
					>
				</Card.Header>
				<Card.Content class="p-6 space-y-6">
					<!-- Linked Email Addresses Section (Option 1: Glassmorphic Dashboard) -->
					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<span class="text-xs font-bold text-zinc-400 uppercase tracking-wider block"
								>Linked Email Addresses</span
							>
						</div>

						{#if loadingAuthMethods}
							<div
								class="flex items-center justify-center py-8 bg-zinc-900/10 border border-zinc-800/80 rounded-xl"
							>
								<LoaderCircle class="h-6 w-6 animate-spin text-violet-500" />
							</div>
						{:else}
							<!-- Email List -->
							<div class="space-y-3">
								{#if !authMethods?.primaryEmail && (!authMethods?.secondaryEmails || authMethods.secondaryEmails.length === 0)}
									<!-- Empty State -->
									<div
										class="flex flex-col items-center justify-center p-8 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 text-center space-y-3"
									>
										<div
											class="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-850 flex items-center justify-center text-zinc-500"
										>
											<TriangleAlert class="w-5 h-5" />
										</div>
										<div class="space-y-1">
											<h3 class="text-xs font-bold text-white">No Email Address Linked</h3>
											<p class="text-[11px] text-zinc-550 max-w-sm leading-normal">
												Link an email address below to receive OTP codes and enable email sign-in.
											</p>
										</div>
									</div>
								{:else}
									<!-- Primary Email -->
									{#if authMethods?.primaryEmail}
										<div
											class="group flex flex-col sm:flex-row items-center justify-between p-4 rounded-xl bg-zinc-900/20 border border-zinc-800/80 hover:border-violet-500/20 hover:bg-zinc-900/40 transition-all gap-4"
										>
											<div class="flex items-center gap-3 self-center">
												<div
													class="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0"
												>
													<ShieldCheck class="w-4.5 h-4.5" />
												</div>
												<div>
													<div class="flex flex-wrap items-center gap-2">
														<span class="text-sm font-semibold text-white font-mono"
															>{authMethods.primaryEmail}</span
														>
														<span
															class="px-2 py-0.5 text-[8.5px] font-black uppercase tracking-wider rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
														>
															Verified
														</span>
														<span
															class="px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-wider rounded bg-violet-500/10 border border-violet-500/20 text-violet-400"
														>
															Primary
														</span>
													</div>
													<span class="text-[11px] text-zinc-500 mt-0.5 block">
														Primary login &bull; Core account credential
													</span>
												</div>
											</div>
											<div
												class="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end self-center"
											>
												<Button
													size="sm"
													variant="outline"
													disabled={authMethods?.primaryEmail
														? unlinkingEmailMap[authMethods.primaryEmail]
														: false}
													onclick={() => unlinkAnyEmail(authMethods?.primaryEmail || '', true)}
													class="rounded-lg font-bold text-xs border-zinc-800 text-zinc-400 hover:bg-red-950/20 hover:text-red-400 hover:border-red-900/30 cursor-pointer px-3 shrink-0 transition-all"
												>
													{#if authMethods?.primaryEmail && unlinkingEmailMap[authMethods.primaryEmail]}
														<LoaderCircle class="h-3.5 w-3.5 animate-spin text-zinc-400" />
													{:else}
														Remove Email
													{/if}
												</Button>
											</div>
										</div>
									{/if}

									<!-- Secondary Emails -->
									{#if authMethods?.secondaryEmails}
										{#each authMethods.secondaryEmails as secondary (secondary.email)}
											<div
												class="group flex flex-col p-4 rounded-xl bg-zinc-900/20 border border-zinc-800/80 hover:border-violet-500/20 hover:bg-zinc-900/40 transition-all gap-4"
											>
												<div class="flex flex-col sm:flex-row items-center justify-between gap-4">
													<div class="flex items-center gap-3 self-center">
														<div
															class="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 {secondary.verified
																? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
																: 'bg-amber-500/5 border-amber-500/10 text-amber-500/70'}"
														>
															{#if secondary.verified}
																<ShieldCheck class="w-4.5 h-4.5" />
															{:else}
																<LoaderCircle class="w-4.5 h-4.5 animate-spin text-amber-500/70" />
															{/if}
														</div>
														<div>
															<div class="flex flex-wrap items-center gap-2">
																<span
																	class="text-sm font-semibold font-mono {secondary.verified
																		? 'text-white'
																		: 'text-zinc-400'}">{secondary.email}</span
																>
																<span
																	class="px-2 py-0.5 text-[8.5px] font-black uppercase tracking-wider rounded {secondary.verified
																		? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
																		: 'bg-amber-500/10 border border-amber-500/20 text-amber-400'}"
																>
																	{secondary.verified ? 'Verified' : 'Verification Pending'}
																</span>
															</div>
															<span class="text-[11px] text-zinc-500 mt-0.5 block">
																{secondary.verified
																	? 'Connected • Active login pathway'
																	: 'Check inbox for verification code'}
															</span>
														</div>
													</div>
													<div
														class="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end self-center"
													>
														{#if !secondary.verified}
															<Button
																size="sm"
																variant="outline"
																disabled={resendCooldowns[secondary.email] > 0}
																onclick={() => resendVerification(secondary.email)}
																class="rounded-lg font-bold text-xs border-zinc-800 text-amber-400 hover:bg-amber-950/20 hover:border-amber-900/30 cursor-pointer px-3 shrink-0 transition-all"
															>
																{#if resendCooldowns[secondary.email] > 0}
																	Resend ({resendCooldowns[secondary.email]}s)
																{:else}
																	Resend
																{/if}
															</Button>
														{/if}
														<Button
															size="sm"
															variant="outline"
															disabled={unlinkingEmailMap[secondary.email]}
															onclick={() => unlinkAnyEmail(secondary.email, false)}
															class="rounded-lg font-bold text-xs border-zinc-800 text-zinc-400 hover:bg-red-950/20 hover:text-red-400 hover:border-red-900/30 cursor-pointer px-3 shrink-0 transition-all"
														>
															{#if unlinkingEmailMap[secondary.email]}
																<LoaderCircle class="h-3.5 w-3.5 animate-spin text-zinc-400" />
															{:else}
																{secondary.verified ? 'Remove Email' : 'Cancel'}
															{/if}
														</Button>
													</div>
												</div>

												{#if !secondary.verified}
													<div
														class="pt-3 border-t border-zinc-900 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full justify-end"
													>
														<div>
															<input
																type="text"
																inputmode="numeric"
																maxlength="6"
																pattern="\d{6}"
																placeholder="6-digit code"
																bind:value={pendingOtpCodes[secondary.email]}
																oninput={(e) => {
																	pendingOtpCodes[secondary.email] = e.currentTarget.value.replace(
																		/\D/g,
																		''
																	);
																}}
																required
																class="w-full sm:w-40 px-4 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-550 focus:ring-1 focus:ring-violet-550 transition-all font-mono text-center"
															/>
														</div>
														<Button
															onclick={() => verifyPendingEmail(secondary.email)}
															disabled={pendingOtpLoading[secondary.email] ||
																(pendingOtpCodes[secondary.email] || '').length !== 6}
															class="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md shadow-violet-950/20 gap-2 shrink-0 cursor-pointer h-9"
														>
															{#if pendingOtpLoading[secondary.email]}
																<LoaderCircle class="h-3.5 w-3.5 animate-spin" />
															{:else}
																Verify Code
															{/if}
														</Button>
													</div>
													{#if pendingOtpErrors[secondary.email]}
														<p class="text-xs text-red-400 font-semibold mt-1 text-right">
															{pendingOtpErrors[secondary.email]}
														</p>
													{/if}
												{/if}
											</div>
										{/each}
									{/if}
								{/if}
							</div>

							<!-- Add Email Form Card -->
							<div
								class="p-5 rounded-2xl border border-zinc-850 bg-zinc-900/10 backdrop-blur-md relative overflow-hidden mt-4"
							>
								<div
									class="flex flex-col lg:flex-row items-center justify-between gap-6 relative z-10"
								>
									<div class="space-y-1.5 self-center">
										<h3 class="text-base font-bold text-white flex items-center gap-2">
											<svg
												xmlns="http://www.w3.org/2000/svg"
												width="16"
												height="16"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												class="text-violet-400 shrink-0"
												><path d="M5 12h14" /><path d="M12 5v14" /></svg
											>
											Link Additional Email
										</h3>
										<p class="text-xs text-zinc-400 max-w-xl leading-relaxed">
											Link another email address to log in seamlessly and handle account recovery.
											You will receive a verification code.
										</p>
									</div>

									{#if authMethods && 1 + authMethods.secondaryEmails.length >= 5}
										<div
											class="flex items-center gap-2 text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3.5 py-2.5 rounded-xl text-xs font-semibold w-full lg:w-auto max-w-sm self-center"
										>
											<TriangleAlert class="w-4.5 h-4.5 shrink-0" />
											<span
												>Limit reached (max 5 total emails). Remove one to link a new address.</span
											>
										</div>
									{:else}
										<form
											onsubmit={linkEmail}
											class="flex items-center gap-2.5 w-full lg:w-auto max-w-sm self-center"
										>
											<input
												type="email"
												placeholder="new.email@example.com"
												bind:value={linkingEmailAddress}
												required
												class="w-full lg:w-60 h-10 px-4 py-2.5 text-sm bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-550 transition-all font-mono"
											/>
											<Button
												type="submit"
												disabled={linkingLoading}
												class="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs px-4 py-3 rounded-xl transition-all shadow-md shadow-violet-950/20 gap-2 shrink-0 cursor-pointer h-10"
											>
												{#if linkingLoading}
													<LoaderCircle class="h-4 w-4 animate-spin" />
												{:else}
													Link Email
												{/if}
											</Button>
										</form>
									{/if}
								</div>

								{#if linkErrorMessage}
									<p class="text-xs text-red-400 mt-2 font-semibold">{linkErrorMessage}</p>
								{/if}
								{#if linkSuccessMessage}
									<p class="text-xs text-emerald-400 mt-2 font-semibold">
										{linkSuccessMessage}
									</p>
								{/if}
							</div>
						{/if}
					</div>

					<Separator class="bg-zinc-900" />

					<!-- Linked Social Accounts list -->
					<div class="space-y-4">
						<span class="text-xs font-bold text-zinc-400 uppercase tracking-wider block"
							>Connected Providers</span
						>

						{#if loadingAccounts}
							<div class="flex items-center justify-center py-6">
								<LoaderCircle class="h-6 w-6 animate-spin text-violet-500" />
							</div>
						{:else}
							<!-- Discord Provider -->
							<div
								class="flex items-center justify-between p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80"
							>
								<div class="flex items-center gap-3 self-center">
									<DiscordIcon class="w-5 h-5 text-[#5865F2]" />
									<div>
										<span class="text-sm font-semibold text-white block">Discord Connection</span>
										{#if linkedAccounts.some((acc) => acc.providerId === 'discord')}
											<span class="text-xs text-emerald-400 mt-1 block">Connected</span>
										{:else}
											<span class="text-xs text-zinc-550 mt-1 block">Not connected</span>
										{/if}
									</div>
								</div>
								{#if linkedAccounts.some((acc) => acc.providerId === 'discord')}
									<Button
										size="sm"
										variant="destructive"
										onclick={() => unlinkProvider('discord')}
										class="rounded-lg font-bold text-xs bg-red-950/20 text-red-400 border border-red-900/30 hover:bg-red-500 hover:text-white cursor-pointer self-center"
									>
										Unlink
									</Button>
								{:else}
									<Button
										size="sm"
										variant="outline"
										onclick={() => linkProvider('discord')}
										class="rounded-lg font-bold text-xs border-zinc-800 text-zinc-300 hover:bg-zinc-850 hover:text-white cursor-pointer self-center"
									>
										<Link2 class="h-3 w-3 mr-1.5" /> Link
									</Button>
								{/if}
							</div>

							<!-- Google Provider -->
							<div
								class="flex items-center justify-between p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80"
							>
								<div class="flex items-center gap-3 self-center">
									<GoogleIcon class="w-5 h-5" />
									<div>
										<span class="text-sm font-semibold text-white block">Google Account</span>
										{#if linkedAccounts.some((acc) => acc.providerId === 'google')}
											<span class="text-xs text-emerald-400 mt-1 block">Connected</span>
										{:else}
											<span class="text-xs text-zinc-550 mt-1 block">Not connected</span>
										{/if}
									</div>
								</div>
								{#if linkedAccounts.some((acc) => acc.providerId === 'google')}
									<Button
										size="sm"
										variant="destructive"
										onclick={() => unlinkProvider('google')}
										class="rounded-lg font-bold text-xs bg-red-950/20 text-red-400 border border-red-900/30 hover:bg-red-500 hover:text-white cursor-pointer self-center"
									>
										Unlink
									</Button>
								{:else}
									<Button
										size="sm"
										variant="outline"
										onclick={() => linkProvider('google')}
										class="rounded-lg font-bold text-xs border-zinc-800 text-zinc-300 hover:bg-zinc-850 hover:text-white cursor-pointer self-center"
									>
										<Link2 class="h-3 w-3 mr-1.5" /> Link
									</Button>
								{/if}
							</div>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Game Accounts & Profiles Management -->
			<Card.Root
				class="bg-zinc-950/60 backdrop-blur-xl border-zinc-800 rounded-2xl overflow-hidden shadow-xl shadow-black/30 p-0 gap-0"
			>
				<Card.Header
					class="bg-linear-to-b from-zinc-900/50 to-transparent p-6 border-b border-zinc-900"
				>
					<div class="flex items-center gap-3">
						<Gamepad2 class="w-5 h-5 text-violet-400" />
						<Card.Title class="text-white text-lg font-bold">Game Accounts & Profiles</Card.Title>
					</div>
					<Card.Description class="text-zinc-500 mt-1"
						>Manage multiple game accounts (UIDs), set primary profiles, and assign custom
						nicknames.</Card.Description
					>
				</Card.Header>
				<Card.Content class="p-6 space-y-6">
					{#if groupedGameAccounts.length === 0}
						<div
							class="flex flex-col items-center justify-center py-10 text-center rounded-xl bg-zinc-900/10 border border-zinc-850"
						>
							<Gamepad2 class="w-10 h-10 text-zinc-600 mb-3" />
							<p class="text-sm font-semibold text-zinc-300">No game accounts tracked yet</p>
							<p class="text-xs text-zinc-500 mt-1 max-w-sm">
								Import pulls via file upload or extraction scripts to automatically link your game
								UIDs.
							</p>
						</div>
					{:else}
						<div class="space-y-6">
							{#each groupedGameAccounts as group (group.gameId)}
								<div class="space-y-3">
									<div class="flex items-center justify-between">
										<div class="flex items-center gap-2">
											<span class="text-xs font-bold text-zinc-300 uppercase tracking-wider">
												{group.gameDisplayName}
											</span>
											<span class="text-[10px] text-zinc-500 font-mono">
												({group.accounts.length}
												{group.accounts.length === 1 ? 'account' : 'accounts'})
											</span>
										</div>
									</div>

									<div class="grid gap-3">
										{#each group.accounts as acc (acc.id)}
											{@const key = `${acc.gameId}:${acc.gameUid}`}
											<div
												class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl bg-zinc-900/20 border border-zinc-800/80 hover:border-zinc-700/80 transition-all gap-4"
											>
												<div class="flex items-center gap-3.5 min-w-0">
													<div
														class="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 {acc.isPrimary
															? 'bg-violet-500/10 border-violet-500/20 text-violet-400'
															: 'bg-zinc-900/50 border-zinc-800 text-zinc-400'}"
													>
														{#if acc.isPrimary}
															<Crown class="w-5 h-5 text-violet-400" />
														{:else}
															<User class="w-5 h-5 text-zinc-500" />
														{/if}
													</div>

													<div class="min-w-0">
														<div class="flex items-center gap-2 flex-wrap">
															{#if editingState[key]}
																<div class="flex items-center gap-2">
																	<input
																		type="text"
																		placeholder="Nickname"
																		aria-label="Nickname for UID {acc.gameUid}"
																		maxlength="50"
																		value={editingNicknames[key] ?? acc.nickname ?? ''}
																		oninput={(e) => {
																			editingNicknames[key] = e.currentTarget.value;
																		}}
																		class="h-8 px-2.5 py-1 text-xs bg-zinc-950 border border-violet-500/50 rounded-lg text-white font-semibold focus:outline-none focus:ring-1 focus:ring-violet-500"
																	/>
																	<Button
																		size="sm"
																		disabled={updatingAccountMap[key]}
																		onclick={() => saveAccountNickname(acc.gameId, acc.gameUid)}
																		class="h-8 px-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-bold cursor-pointer"
																	>
																		Save
																	</Button>
																	<Button
																		size="sm"
																		variant="ghost"
																		onclick={() => (editingState[key] = false)}
																		class="h-8 px-2 text-zinc-400 hover:text-white rounded-lg text-xs cursor-pointer"
																	>
																		Cancel
																	</Button>
																</div>
															{:else}
																<span class="text-sm font-bold text-white truncate">
																	{acc.nickname || `UID: ${acc.gameUid}`}
																</span>
																<button
																	type="button"
																	onclick={() => {
																		editingNicknames[key] = acc.nickname ?? '';
																		editingState[key] = true;
																	}}
																	class="text-zinc-500 hover:text-zinc-300 transition-colors p-1 cursor-pointer"
																	title="Edit Nickname"
																>
																	<Edit3 class="w-3.5 h-3.5" />
																</button>
															{/if}

															{#if acc.isPrimary}
																<span
																	class="px-2 py-0.5 text-[8.5px] font-black uppercase tracking-wider rounded bg-violet-500/10 border border-violet-500/20 text-violet-400"
																>
																	Primary Account
																</span>
															{/if}
														</div>

														<div
															class="flex items-center gap-3 text-xs text-zinc-500 mt-1 font-mono"
														>
															<span>UID: {acc.gameUid}</span>
															{#if acc.lastImport}
																<span class="text-zinc-600">&bull;</span>
																<span class="text-zinc-500 text-[11px] font-sans">
																	Last imported: {new Date(acc.lastImport).toLocaleDateString()}
																</span>
															{/if}
														</div>
													</div>
												</div>

												{#if !acc.isPrimary}
													<div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
														<Button
															size="sm"
															variant="outline"
															disabled={updatingAccountMap[key]}
															onclick={() => setPrimaryAccount(acc.gameId, acc.gameUid)}
															class="rounded-lg font-bold text-xs border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white cursor-pointer px-3 h-8"
														>
															{#if updatingAccountMap[key]}
																<LoaderCircle class="h-3.5 w-3.5 animate-spin" />
															{:else}
																Set as Primary
															{/if}
														</Button>
													</div>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/each}

							<div
								class="pt-3 border-t border-zinc-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-zinc-500"
							>
								<span>Need to remove an account or wipe pull logs?</span>
								<button
									type="button"
									onclick={() => (activeTab = 'danger')}
									class="text-red-400 hover:text-red-300 font-semibold cursor-pointer transition-colors"
								>
									Manage purges in Danger Zone &rarr;
								</button>
							</div>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<!-- 2. PREFERENCES PANEL -->
		<Tabs.Content value="preferences" class="space-y-6 outline-none">
			{#if settingsLoaderError}
				<div
					class="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300"
				>
					<div class="flex items-center gap-3">
						<span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping shrink-0"></span>
						<div>
							<p class="text-sm font-bold text-white">Connection Error</p>
							<p class="text-xs text-zinc-400 mt-0.5">
								Failed to load settings. Please check your connection and try again.
							</p>
						</div>
					</div>
					<Button
						onclick={retryFetch}
						disabled={retrying}
						variant="destructive"
						class="font-bold px-4 py-2 rounded-xl text-xs gap-1.5 cursor-pointer bg-red-600 hover:bg-red-500 text-white"
					>
						{#if retrying}
							<LoaderCircle class="h-3.5 w-3.5 animate-spin" />
							Retrying...
						{:else}
							Retry Loading
						{/if}
					</Button>
				</div>
			{/if}

			<Card.Root
				class="bg-zinc-950/60 backdrop-blur-xl border-zinc-800 rounded-2xl overflow-hidden shadow-xl shadow-black/30 p-0 gap-0"
			>
				<Card.Header
					class="bg-linear-to-b from-zinc-900/50 to-transparent p-6 border-b border-zinc-900"
				>
					<div class="flex items-center gap-3">
						<Palette class="w-5 h-5 text-violet-400" />
						<Card.Title class="text-white text-lg font-bold">Design & Aesthetics</Card.Title>
					</div>
					<Card.Description class="text-zinc-500 mt-1"
						>Customize visual layouts, color themes, and pity counters display.</Card.Description
					>
				</Card.Header>
				<Card.Content class="p-6 space-y-8">
					<!-- Curated Themes Selector -->
					<div class="grid gap-3">
						<span class="text-xs font-bold text-zinc-400 uppercase tracking-wider"
							>Curated App Theme</span
						>
						<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
							<button
								type="button"
								onclick={() => {
									theme = 'system';
									updateClientTheme('system');
								}}
								disabled={settingsLoaderError || !settings}
								class="p-4 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left transition-all hover:scale-[1.01] cursor-pointer {theme ===
								'system'
									? 'border-violet-500 ring-4 ring-violet-500/10'
									: 'border-zinc-800'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:scale-100"
							>
								<span class="text-sm font-bold text-white block">Default Dark</span>
								<span class="text-xs text-zinc-500 block mt-1.5"
									>Standard deep space obsidian styling</span
								>
							</button>

							<button
								type="button"
								onclick={() => {
									theme = 'quantum-dark';
									updateClientTheme('quantum-dark');
								}}
								disabled={settingsLoaderError || !settings}
								class="p-4 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left transition-all hover:scale-[1.01] cursor-pointer {theme ===
								'quantum-dark'
									? 'border-purple-500 ring-4 ring-purple-500/10'
									: 'border-zinc-800'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:scale-100"
							>
								<span class="text-sm font-bold text-white block">Quantum Dark</span>
								<span class="text-xs text-purple-400 block mt-1.5"
									>HSR-inspired deep purple & obsidian</span
								>
							</button>

							<button
								type="button"
								onclick={() => {
									theme = 'amber-dawn';
									updateClientTheme('amber-dawn');
								}}
								disabled={settingsLoaderError || !settings}
								class="p-4 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left transition-all hover:scale-[1.01] cursor-pointer {theme ===
								'amber-dawn'
									? 'border-yellow-600 ring-4 ring-yellow-600/10'
									: 'border-zinc-800'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:scale-100"
							>
								<span class="text-sm font-bold text-white block">Amber Dawn</span>
								<span class="text-xs text-yellow-500 block mt-1.5"
									>Genshin-inspired warm golds & stones</span
								>
							</button>

							<button
								type="button"
								onclick={() => {
									theme = 'wobbly-waves';
									updateClientTheme('wobbly-waves');
								}}
								disabled={settingsLoaderError || !settings}
								class="p-4 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left transition-all hover:scale-[1.01] cursor-pointer {theme ===
								'wobbly-waves'
									? 'border-teal-500 ring-4 ring-teal-500/10'
									: 'border-zinc-800'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:scale-100"
							>
								<span class="text-sm font-bold text-white block">Wobbly Waves</span>
								<span class="text-xs text-teal-400 block mt-1.5"
									>WuWa-inspired glowing emeralds & navy</span
								>
							</button>
						</div>
					</div>

					<Separator class="bg-zinc-900" />

					<!-- Pity Counter Style -->
					<div class="grid gap-3">
						<span class="text-xs font-bold text-zinc-400 uppercase tracking-wider"
							>Pity Tracker Display Mode</span
						>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							<button
								type="button"
								onclick={() => (pityDisplayMode = 'count_up')}
								disabled={settingsLoaderError || !settings}
								class="p-4 rounded-xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left cursor-pointer transition-all {pityDisplayMode ===
								'count_up'
									? 'border-zinc-400 ring-2 ring-white/5'
									: 'border-zinc-800'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40"
							>
								<span class="text-sm font-bold text-white block">Standard Count-Up</span>
								<span class="text-xs text-zinc-500 block mt-1.5"
									>Pity counts up: "Pity: 67 / 90 pulls"</span
								>
							</button>
							<button
								type="button"
								onclick={() => (pityDisplayMode = 'count_down')}
								disabled={settingsLoaderError || !settings}
								class="p-4 rounded-xl bg-zinc-900/40 hover:bg-zinc-900/80 border text-left cursor-pointer transition-all {pityDisplayMode ===
								'count_down'
									? 'border-zinc-400 ring-2 ring-white/5'
									: 'border-zinc-800'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40"
							>
								<span class="text-sm font-bold text-white block">Hard Pity Countdown</span>
								<span class="text-xs text-zinc-500 block mt-1.5"
									>Countdown style: "23 pulls to Hard Pity"</span
								>
							</button>
						</div>
					</div>

					<!-- Save preferences button -->
					<div class="flex justify-end pt-4">
						<Button
							onclick={savePreferences}
							disabled={saving || settingsLoaderError || !settings}
							class="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-violet-600/10 gap-2 cursor-pointer"
						>
							{#if saving}
								<LoaderCircle class="h-4 w-4 animate-spin" />Saving...
							{:else}
								Save Preferences
							{/if}
						</Button>
					</div>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<!-- DATA MANAGEMENT PANEL -->
		<Tabs.Content value="data" class="space-y-6 outline-none">
			<Card.Root
				class="bg-zinc-950/60 backdrop-blur-xl border-zinc-800 rounded-2xl overflow-hidden shadow-xl shadow-black/30 p-0 gap-0"
			>
				<Card.Header
					class="bg-linear-to-b from-zinc-900/50 to-transparent p-6 border-b border-zinc-900"
				>
					<div class="flex items-center gap-3">
						<Download class="w-5 h-5 text-indigo-400" />
						<Card.Title class="text-white text-lg font-bold">Backup & Export</Card.Title>
					</div>
					<Card.Description class="text-zinc-500 mt-1"
						>Export your entire gacha history across all games to a JSON file.</Card.Description
					>
				</Card.Header>
				<Card.Content class="p-6 space-y-6">
					<div
						class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl bg-zinc-900/20 border border-zinc-800/80 gap-4"
					>
						<div class="space-y-1">
							<span class="text-sm font-bold text-white block">Download JSON Backup</span>
							<span class="text-xs text-zinc-500 block leading-relaxed"
								>Saves all your tracked pull logs. Keep this file safe to restore your data at any
								time.</span
							>
						</div>
						<Button
							size="sm"
							onclick={exportData}
							class="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 hover:text-white rounded-xl px-5 py-2.5 font-bold w-full sm:w-auto cursor-pointer gap-2 shrink-0"
						>
							<Download class="h-4 w-4" /> Export Data
						</Button>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root
				class="bg-zinc-950/60 backdrop-blur-xl border-zinc-800 rounded-2xl overflow-hidden shadow-xl shadow-black/30 p-0 gap-0"
			>
				<Card.Header
					class="bg-linear-to-b from-zinc-900/50 to-transparent p-6 border-b border-zinc-900"
				>
					<div class="flex items-center gap-3">
						<Upload class="w-5 h-5 text-indigo-400" />
						<Card.Title class="text-white text-lg font-bold">Import History</Card.Title>
					</div>
					<Card.Description class="text-zinc-500 mt-1"
						>Upload your gacha history files to merge them with your current logs.</Card.Description
					>
				</Card.Header>
				<Card.Content class="p-6 space-y-6">
					<!-- Format Selection -->
					<div class="grid gap-2">
						<label
							for="import-format"
							class="text-xs font-bold text-zinc-400 uppercase tracking-wider">Import Format</label
						>
						{#if loadingFormats}
							<div
								class="h-10 w-full bg-zinc-900/40 animate-pulse border border-zinc-800 rounded-xl"
							></div>
						{:else}
							<select
								id="import-format"
								bind:value={selectedFormat}
								class="w-full rounded-xl bg-zinc-900 border border-zinc-800 p-3 text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 cursor-pointer"
							>
								{#each formats as format (format.id)}
									<option value={format.id}>{format.displayName}</option>
								{/each}
							</select>
						{/if}
					</div>

					{#if selectedFormat === 'paimon-moe'}
						<!-- Genshin UID input for paimon-moe -->
						<div class="grid gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
							<label
								for="import-game-uid"
								class="text-xs font-bold text-zinc-400 uppercase tracking-wider"
								>Genshin Impact UID</label
							>
							<input
								type="text"
								id="import-game-uid"
								bind:value={gameUid}
								oninput={(e) => {
									gameUid = e.currentTarget.value.replace(/\D/g, '');
									e.currentTarget.value = gameUid;
								}}
								placeholder="Enter UID (9 or 10 digits)"
								maxlength="10"
								disabled={importing}
								class="w-full rounded-xl bg-zinc-900 border border-zinc-800 p-3 text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
							/>
						</div>
					{:else if selectedFormat === 'starrail-station'}
						{#if inspectingSrs}
							<div
								class="flex items-center gap-2 p-3 bg-zinc-900/40 border border-zinc-800 rounded-xl text-zinc-400 text-xs animate-pulse"
							>
								<LoaderCircle class="w-4 h-4 animate-spin text-indigo-400" />
								<span>Inspecting Star Rail Station backup profiles...</span>
							</div>
						{:else if srsProfiles.length > 1}
							<!-- Multi-profile SRS detected -->
							<div
								class="grid gap-3 p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 animate-in fade-in slide-in-from-top-1 duration-200"
							>
								<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
									<span class="text-xs font-bold text-zinc-300 uppercase tracking-wider">
										Multiple Profiles Detected ({srsProfiles.length})
									</span>
									<span class="text-xs text-zinc-500"
										>Assign a Honkai: Star Rail UID to each profile</span
									>
								</div>
								<div class="space-y-3 pt-1">
									{#each srsProfiles as profile (profile.key)}
										<div class="p-3 rounded-xl bg-zinc-950/60 border border-zinc-850 space-y-2">
											<div class="flex items-center justify-between">
												<span class="text-sm font-bold text-zinc-200">{profile.name}</span>
												<span
													class="text-xs font-medium text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20"
												>
													{profile.warpCount} warps
												</span>
											</div>
											<input
												type="text"
												aria-label="UID for profile {profile.name}"
												bind:value={srsProfileUids[profile.key]}
												oninput={(e) => {
													const val = e.currentTarget.value.replace(/\D/g, '');
													srsProfileUids[profile.key] = val;
													e.currentTarget.value = val;
												}}
												placeholder="Enter UID for {profile.name} (9 digits)"
												maxlength="9"
												disabled={importing}
												class="w-full rounded-xl bg-zinc-900 border border-zinc-800 p-2.5 text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
											/>
										</div>
									{/each}
								</div>
							</div>
						{:else}
							<!-- Single UID input for Star Rail Station -->
							<div class="grid gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
								<label
									for="import-srs-uid"
									class="text-xs font-bold text-zinc-400 uppercase tracking-wider"
									>Honkai: Star Rail UID</label
								>
								<input
									type="text"
									id="import-srs-uid"
									bind:value={srsSingleUid}
									oninput={(e) => {
										srsSingleUid = e.currentTarget.value.replace(/\D/g, '');
										e.currentTarget.value = srsSingleUid;
									}}
									placeholder="Enter UID (9 digits)"
									maxlength="9"
									disabled={importing}
									class="w-full rounded-xl bg-zinc-900 border border-zinc-800 p-3 text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
								/>
								{#if srsProfiles.length === 1}
									<span class="text-xs text-zinc-500">
										Profile detected: <strong class="text-zinc-300">{srsProfiles[0].name}</strong>
										({srsProfiles[0].warpCount} warps)
									</span>
								{/if}
							</div>
						{/if}
					{/if}

					<!-- File Dropzone -->
					<div class="grid gap-2">
						<span
							id="backup-file-label"
							class="text-xs font-bold text-zinc-400 uppercase tracking-wider"
							>Select Backup File</span
						>
						<div
							class="border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-900/10 hover:bg-zinc-900/30 rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all relative min-h-40 focus-within:ring-2 focus-within:ring-indigo-500/40 focus-within:border-indigo-500/50"
						>
							<input
								type="file"
								id="backup-file-input"
								bind:this={fileInputRef}
								aria-labelledby="backup-file-label"
								accept={acceptedExtensions}
								onchange={handleFileChange}
								class="absolute inset-0 opacity-0 cursor-pointer focus:outline-none"
								disabled={importing || queueStatus === 'queued' || queueStatus === 'processing'}
							/>
							{#if importFile}
								<div class="flex flex-col items-center gap-2">
									<div class="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
										<Upload class="w-6 h-6" />
									</div>
									<span class="text-sm font-bold text-zinc-200">{importFile.name}</span>
									<span class="text-xs text-zinc-500">{(importFile.size / 1024).toFixed(1)} KB</span
									>
								</div>
							{:else}
								<div class="flex flex-col items-center gap-2">
									<div class="p-3 bg-zinc-850 rounded-xl text-zinc-500">
										<Upload class="w-6 h-6 animate-pulse" />
									</div>
									<span class="text-sm font-bold text-zinc-350"
										>Drag and drop file or click to browse</span
									>
									<span class="text-xs text-zinc-500"
										>Supports {formatExtensionsList(acceptedExtensions)} backups (Max 5MB)</span
									>
								</div>
							{/if}
						</div>
					</div>

					<!-- Queue Status / Processing Panel -->
					{#if queueStatus === 'queued' || queueStatus === 'processing'}
						<div
							class="p-4 rounded-xl border border-zinc-800 bg-zinc-950/40 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200"
						>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<LoaderCircle class="w-5 h-5 text-indigo-400 animate-spin" />
									<div>
										<span class="text-sm font-bold text-zinc-200">
											{#if queueStatus === 'queued'}
												Import Queued
											{:else}
												Processing Import
											{/if}
										</span>
										<div class="text-xs text-zinc-500 mt-0.5">
											{#if queueStatus === 'queued'}
												Position in queue: <strong class="text-indigo-400"
													>#{queuePosition ?? '?'}</strong
												>
												{#if queuePosition === 1}
													<span class="text-zinc-600 ml-1">(you're up next)</span>
												{/if}
											{:else}
												Draining pulls & building adapter...
											{/if}
										</div>
									</div>
								</div>

								<div class="text-right">
									<span class="text-xs font-mono text-zinc-400">
										Waited: {Math.floor(queueWaitedSeconds / 60)}:{(queueWaitedSeconds % 60)
											.toString()
											.padStart(2, '0')}
									</span>
								</div>
							</div>

							{#if queueStatus === 'queued'}
								<div class="flex justify-end border-t border-zinc-900 pt-3">
									<Button
										onclick={handleCancelQueue}
										variant="ghost"
										class="text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs px-3.5 py-1.5 h-auto font-bold gap-1.5 cursor-pointer rounded-lg"
									>
										<CircleX class="w-3.5 h-3.5" />
										Cancel Wait
									</Button>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Import Action -->
					<div class="flex justify-end pt-2">
						<Button
							onclick={handleImport}
							disabled={importing ||
								inspectingSrs ||
								!importFile ||
								cooldownRemaining > 0 ||
								queueStatus === 'queued' ||
								queueStatus === 'processing' ||
								(selectedFormat === 'paimon-moe' && gameUid.length < 9)}
							class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-indigo-600/10 gap-2 cursor-pointer"
						>
							{#if queueStatus === 'queued'}
								<LoaderCircle class="h-4 w-4 animate-spin" /> Queued...
							{:else if importing}
								<LoaderCircle class="h-4 w-4 animate-spin" /> Importing...
							{:else if inspectingSrs}
								<LoaderCircle class="h-4 w-4 animate-spin" /> Inspecting...
							{:else if cooldownRemaining > 0}
								<Clock class="h-4 w-4" /> Cooldown ({cooldownRemaining}s)
							{:else}
								<Upload class="h-4 w-4" /> Start Import
							{/if}
						</Button>
					</div>

					<!-- Import feedback -->
					{#if importError}
						<div
							class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 animate-in fade-in slide-in-from-top-1 duration-200"
						>
							<strong>Import Failed:</strong>
							{importError}
						</div>
					{/if}

					{#if importSuccess && importStatusSummary}
						<div
							class="p-5 rounded-xl border space-y-3 animate-in fade-in slide-in-from-top-1 duration-200 {importStatusSummary.bgClass}"
						>
							<div class="flex items-center justify-between">
								<span class="text-sm font-bold block {importStatusSummary.titleClass}"
									>{importStatusSummary.title}</span
								>
								<Button
									onclick={dismissImportSummary}
									variant="ghost"
									size="sm"
									class="text-xs text-zinc-400 hover:text-zinc-200 h-auto py-1 px-2 cursor-pointer"
								>
									Dismiss
								</Button>
							</div>
							<div
								class="divide-y divide-zinc-900 border border-zinc-900 rounded-xl overflow-hidden bg-zinc-950/40"
							>
								{#each importSuccess as item (item.gameId + ':' + item.gameUid)}
									<div class="p-3.5 flex items-center justify-between text-xs">
										<div class="space-y-1">
											<span
												class="font-bold text-zinc-200 block uppercase tracking-wider text-[10px]"
												>{item.gameId}</span
											>
											<span class="text-zinc-500 block">Account UID: {item.gameUid}</span>
										</div>
										<span
											class="font-bold px-2.5 py-1 rounded-full {item.success
												? 'text-emerald-400 bg-emerald-500/10'
												: 'text-red-400 bg-red-500/10'}">{item.message}</span
										>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<!-- 3. DANGER ZONE PANEL -->
		<Tabs.Content value="danger" class="space-y-6 outline-none">
			<Card.Root
				class="bg-red-950/5 border-red-950/40 backdrop-blur-xl rounded-2xl overflow-hidden shadow-xl shadow-black/40 p-0 gap-0"
			>
				<Card.Header
					class="bg-linear-to-b from-red-950/10 to-transparent p-6 border-b border-red-950/20"
				>
					<div class="flex items-center gap-3">
						<TriangleAlert class="w-5 h-5 text-red-400" />
						<Card.Title class="text-red-400 text-lg font-bold"
							>Data & Security Administration</Card.Title
						>
					</div>
					<Card.Description class="text-zinc-500 mt-1"
						>Erase pulls data histories, download database backups, or request account
						deactivations.</Card.Description
					>
				</Card.Header>
				<Card.Content class="p-6 space-y-8">
					<!-- Download raw backup JSON -->
					<div
						class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl bg-zinc-950/80 border border-zinc-900 gap-4"
					>
						<div>
							<span class="text-sm font-bold text-white block">Download DB Backup (JSON)</span>
							<span class="text-xs text-zinc-500 mt-1 block"
								>Download a complete backup containing all pulled log entries.</span
							>
						</div>
						<Button
							size="sm"
							onclick={exportData}
							class="bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-200 hover:text-white rounded-lg px-4 gap-2 font-bold w-full sm:w-auto cursor-pointer"
						>
							<Download class="h-4 w-4" /> Download Backup
						</Button>
					</div>

					<Separator class="bg-red-950/10" />

					<!-- Selective game & profile purges -->
					<div class="space-y-4">
						<div>
							<h3 class="text-sm font-bold text-zinc-200">Selective Game & Profile Purges</h3>
							<p class="text-xs text-zinc-500 mt-1">
								Wipe pull history entries for an entire game or selectively purge individual
								profiles (UIDs).
							</p>
						</div>

						{#if groupedGameAccounts.length === 0}
							<span class="text-xs text-zinc-650 italic block py-2"
								>No active sync game logs found.</span
							>
						{:else}
							<div class="grid gap-4">
								{#each groupedGameAccounts as group (group.gameId)}
									<div class="p-4 rounded-xl bg-zinc-950/80 border border-zinc-900 space-y-3">
										<div
											class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-zinc-900"
										>
											<div class="space-y-0.5">
												<span class="text-sm font-bold text-zinc-200 block"
													>{group.gameDisplayName}</span
												>
												<span class="text-xs text-zinc-500 font-mono block">
													{group.accounts.length}
													{group.accounts.length === 1 ? 'profile' : 'profiles'} tracked
												</span>
											</div>
											<Button
												size="sm"
												variant="destructive"
												onclick={() => purgeGameData(group.gameId, group.gameDisplayName)}
												class="rounded-lg font-bold text-xs bg-red-950/30 hover:bg-red-600 text-red-400 hover:text-white border border-red-900/30 cursor-pointer"
											>
												<Trash2 class="h-3.5 w-3.5 mr-1.5" /> Purge Entire Game ({group.gameDisplayName})
											</Button>
										</div>

										<div class="space-y-2 pt-1">
											<span
												class="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block"
											>
												Individual Profiles
											</span>
											<div class="grid gap-2">
												{#each group.accounts as acc (acc.id)}
													<div
														class="flex items-center justify-between p-3 rounded-lg bg-zinc-900/30 border border-zinc-850 gap-3"
													>
														<div class="min-w-0">
															<div class="flex items-center gap-2 flex-wrap">
																<span class="text-xs font-bold text-zinc-200 truncate">
																	{acc.nickname || `UID: ${acc.gameUid}`}
																</span>
																{#if acc.isPrimary}
																	<span
																		class="px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-wider rounded bg-violet-500/10 border border-violet-500/20 text-violet-400"
																	>
																		Primary
																	</span>
																{/if}
															</div>
															<div class="text-[11px] text-zinc-500 font-mono mt-0.5">
																UID: {acc.gameUid}
																{#if acc.lastImport}
																	&bull; Last imported: {new Date(
																		acc.lastImport
																	).toLocaleDateString()}
																{/if}
															</div>
														</div>

														<Button
															size="sm"
															variant="outline"
															onclick={() =>
																purgeProfileData(
																	acc.gameId,
																	acc.gameUid,
																	acc.nickname
																		? `${acc.nickname} (${acc.gameUid})`
																		: `UID: ${acc.gameUid}`
																)}
															class="rounded-lg font-bold text-xs border-zinc-800 text-zinc-400 hover:bg-red-950/20 hover:text-red-400 hover:border-red-900/30 cursor-pointer px-3 h-8 transition-all shrink-0"
														>
															<Trash2 class="h-3.5 w-3.5 mr-1" /> Purge Profile
														</Button>
													</div>
												{/each}
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<Separator class="bg-red-950/10" />

					<!-- Hard deletion request -->
					<div
						class="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl bg-red-950/10 border border-red-900/30 gap-4"
					>
						<div>
							<span class="text-sm font-bold text-red-200 block">Delete Account</span>
							<span class="text-xs text-red-400/70 mt-1.5 block"
								>Permanently deletes your account credentials, settings preferences, and histories.</span
							>
						</div>
						<Button
							size="sm"
							variant="destructive"
							onclick={deleteAccount}
							class="bg-red-600 hover:bg-red-500 text-white rounded-lg px-4 gap-2 font-bold w-full sm:w-auto cursor-pointer"
						>
							<Trash2 class="h-4 w-4" /> Delete Account
						</Button>
					</div>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>
	</Tabs.Root>
</div>

{#if showDeleteModal}
	<div
		transition:fade={{ duration: 150 }}
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
	>
		<div
			transition:scale={{ start: 0.95, duration: 150 }}
			class="w-full max-w-md bg-zinc-950/90 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-2xl p-6 space-y-6"
		>
			<div class="flex items-center gap-3 border-b border-zinc-900 pb-4">
				<div
					class="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400"
				>
					<TriangleAlert class="w-5 h-5" />
				</div>
				<div>
					<h3 class="text-lg font-bold text-white">Permanently Delete Account</h3>
					<p class="text-xs text-zinc-550 mt-0.5">Security verification required</p>
				</div>
			</div>

			{#if deleteStep === 'anonymous'}
				<div class="space-y-4">
					<p class="text-sm text-zinc-300 leading-relaxed">
						This is an anonymous account. To permanently delete your account and wipe all sync pull
						history, you must enter your 16-character account code. <span
							class="text-red-400 font-semibold block mt-1"
							>WARNING: This action is permanent and irreversible.</span
						>
					</p>
					<div class="space-y-2">
						<label
							for="delete-anon-code"
							class="text-xs font-bold text-zinc-400 uppercase tracking-wider block"
						>
							Anonymous Account Code
						</label>
						<input
							type="text"
							id="delete-anon-code"
							placeholder="Enter 16-character code"
							bind:value={deleteAnonCode}
							class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-zinc-650 focus:border-violet-500 focus:outline-none transition-all"
						/>
					</div>
					{#if deleteErrorMessage}
						<p class="text-xs text-red-400 font-semibold">{deleteErrorMessage}</p>
					{/if}
				</div>
				<div class="flex items-center justify-end gap-3 pt-2 border-t border-zinc-900">
					<Button
						variant="outline"
						onclick={() => (showDeleteModal = false)}
						class="rounded-xl font-bold text-xs border-zinc-800 text-zinc-400 hover:bg-zinc-900 cursor-pointer h-10 px-4"
					>
						Cancel
					</Button>
					<Button
						disabled={deletingAccount || deleteAnonCode.length !== 16}
						onclick={confirmDeleteAccount}
						class="bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl h-10 px-5 cursor-pointer gap-2"
					>
						{#if deletingAccount}
							<LoaderCircle class="h-4 w-4 animate-spin" />
							Deleting...
						{:else}
							Confirm & Delete
						{/if}
					</Button>
				</div>
			{:else if deleteStep === 'otp'}
				<div class="space-y-4">
					{#if !deleteOtpSuccess}
						<p class="text-sm text-zinc-350 leading-relaxed">
							A 6-digit security code will be sent to your primary email <span
								class="font-mono text-white font-semibold">{deleteSelectedEmail}</span
							>
							to authorize this change.
							<span class="text-red-400 font-semibold block mt-1"
								>WARNING: This action is permanent and irreversible.</span
							>
						</p>
						<Button
							disabled={deleteOtpSending}
							onclick={sendDeleteOtp}
							class="w-full bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl h-10 cursor-pointer gap-2"
						>
							{#if deleteOtpSending}
								<LoaderCircle class="h-4 w-4 animate-spin text-white" />
								Sending...
							{:else}
								Send Verification Code
							{/if}
						</Button>
					{:else}
						<p class="text-sm text-zinc-300 leading-relaxed">
							Enter the 6-digit security code sent to your primary email <span
								class="font-mono text-white font-semibold">{deleteSelectedEmail}</span
							>.
							<span class="text-red-400 font-semibold block mt-1"
								>WARNING: This action is permanent and irreversible.</span
							>
						</p>

						<div
							class="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 text-xs leading-normal"
						>
							{deleteOtpSuccess}
						</div>

						<div class="space-y-2">
							<label
								for="delete-otp-code"
								class="text-xs font-bold text-zinc-400 uppercase tracking-wider block"
							>
								Verification Code
							</label>
							<div class="flex gap-2">
								<input
									type="text"
									id="delete-otp-code"
									inputmode="numeric"
									maxlength="6"
									pattern="\d{6}"
									placeholder="Enter 6-digit code"
									bind:value={deleteOtpCode}
									oninput={(e) => {
										deleteOtpCode = e.currentTarget.value.replace(/\D/g, '');
									}}
									class="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-zinc-650 focus:border-violet-500 focus:outline-none transition-all"
								/>
								<Button
									disabled={deleteOtpSending}
									onclick={sendDeleteOtp}
									variant="outline"
									class="rounded-xl border-zinc-800 text-zinc-400 hover:bg-zinc-900 font-bold text-xs h-10 px-4 cursor-pointer"
								>
									{#if deleteOtpSending}
										Sending...
									{:else}
										Resend
									{/if}
								</Button>
							</div>
						</div>
					{/if}

					{#if deleteOtpError}
						<p class="text-xs text-red-400 font-semibold">{deleteOtpError}</p>
					{/if}
					{#if deleteErrorMessage}
						<p class="text-xs text-red-400 font-semibold">{deleteErrorMessage}</p>
					{/if}
				</div>
				<div class="flex items-center justify-end gap-3 pt-2 border-t border-zinc-900">
					<Button
						variant="outline"
						onclick={() => (showDeleteModal = false)}
						class="rounded-xl font-bold text-xs border-zinc-800 text-zinc-400 hover:bg-zinc-900 cursor-pointer h-10 px-4"
					>
						Cancel
					</Button>
					<Button
						disabled={deletingAccount || !deleteOtpSuccess || deleteOtpCode.length !== 6}
						onclick={confirmDeleteAccount}
						class="bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl h-10 px-5 cursor-pointer gap-2"
					>
						{#if deletingAccount}
							<LoaderCircle class="h-4 w-4 animate-spin" />
							Deleting...
						{:else}
							Confirm & Delete
						{/if}
					</Button>
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if showUnlinkPrimaryModal}
	<div
		transition:fade={{ duration: 150 }}
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
	>
		<div
			transition:scale={{ start: 0.95, duration: 150 }}
			class="w-full max-w-md bg-zinc-950/90 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-2xl p-6 space-y-6"
		>
			<div class="flex items-center gap-3">
				<div
					class="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400"
				>
					<TriangleAlert class="w-5 h-5" />
				</div>
				<div>
					<h3 class="text-lg font-bold text-white">Unlink Main Email</h3>
					<p class="text-xs text-zinc-550 mt-0.5">
						This action will change your primary login email.
					</p>
				</div>
			</div>

			<div class="space-y-4">
				<p class="text-sm text-zinc-300 leading-relaxed">
					Are you sure you want to remove and unlink your main email address <span
						class="font-mono text-white font-semibold">{authMethods?.primaryEmail}</span
					>?
				</p>

				{#if !useSecondaryForUnlink}
					<div class="space-y-3">
						<span class="text-xs font-bold text-zinc-400 uppercase tracking-wider block">
							Select New Primary Email
						</span>
						<div class="grid gap-2">
							{#each authMethods?.secondaryEmails?.filter((e) => e.verified) || [] as secondary (secondary.email)}
								<button
									type="button"
									onclick={() => (selectedEmailToPromote = secondary.email)}
									class="flex items-center justify-between p-3.5 rounded-xl border text-left cursor-pointer transition-all {selectedEmailToPromote ===
									secondary.email
										? 'border-violet-500 bg-violet-500/5 text-white'
										: 'border-zinc-800 bg-zinc-900/20 text-zinc-400 hover:bg-zinc-900/40'}"
								>
									<span class="text-sm font-semibold font-mono">{secondary.email}</span>
									<div
										class="w-4 h-4 rounded-full border flex items-center justify-center {selectedEmailToPromote ===
										secondary.email
											? 'border-violet-500'
											: 'border-zinc-700'}"
									>
										{#if selectedEmailToPromote === secondary.email}
											<div class="w-2 h-2 rounded-full bg-violet-500"></div>
										{/if}
									</div>
								</button>
							{/each}
						</div>
						<p class="text-[11px] text-zinc-550 leading-normal">
							The selected email address will be promoted to your primary identity, and you will use
							it to log in.
						</p>
					</div>
				{/if}

				{#if authMethods?.primaryEmail && !authMethods.primaryEmail.endsWith('@anon.gacha-tracker.app')}
					<div class="space-y-3 pt-4 border-t border-zinc-900">
						<span class="text-xs font-bold text-zinc-400 uppercase tracking-wider block">
							Security Verification
						</span>

						<!-- Recovery / Lost access link -->
						{#if !unlinkOtpSuccess && !useSecondaryForUnlink}
							<div class="py-1">
								<button
									type="button"
									onclick={toggleLostAccess}
									class="text-xs font-semibold text-violet-400 hover:text-violet-300 underline cursor-pointer focus:outline-none"
								>
									Lost access to this email?
								</button>
							</div>
						{/if}

						{#if useSecondaryForUnlink}
							{#if eligibleSecondaries.length === 0}
								<div
									class="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/10 text-amber-400 text-xs leading-normal"
								>
									No secondary emails verified for at least 48 hours are available for recovery.
								</div>
							{:else}
								<div class="space-y-2">
									<label
										for="recovery-email-select"
										class="text-xs font-bold text-zinc-400 uppercase tracking-wider block"
									>
										Select Recovery Email
									</label>
									<select
										id="recovery-email-select"
										bind:value={selectedSecondaryForUnlink}
										onchange={() => {
											selectedEmailToPromote = selectedSecondaryForUnlink;
											unlinkOtpSuccess = '';
											unlinkOtpError = '';
										}}
										class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:outline-none transition-all cursor-pointer font-mono"
									>
										{#each eligibleSecondaries as sec (sec.email)}
											<option value={sec.email}>{sec.email}</option>
										{/each}
									</select>
								</div>
							{/if}
						{/if}

						{#if !useSecondaryForUnlink || eligibleSecondaries.length > 0}
							{#if !unlinkOtpSuccess}
								<p class="text-xs text-zinc-400 leading-relaxed">
									{#if useSecondaryForUnlink}
										A 6-digit security code will be sent to your recovery email <span
											class="font-mono text-white font-semibold">{selectedSecondaryForUnlink}</span
										> to authorize this change.
									{:else}
										A 6-digit security code will be sent to your current main email <span
											class="font-mono text-white font-semibold">{authMethods.primaryEmail}</span
										> to authorize this change.
									{/if}
								</p>
								<Button
									disabled={unlinkOtpSending}
									onclick={sendUnlinkEmailOtp}
									class="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl h-10 cursor-pointer gap-2"
								>
									{#if unlinkOtpSending}
										<LoaderCircle class="h-4 w-4 animate-spin text-white" />
										Sending...
									{:else}
										Send Verification Code
									{/if}
								</Button>
							{:else}
								<p class="text-xs text-zinc-400 leading-relaxed">
									Enter the 6-digit security code sent to <span
										class="font-mono text-white font-semibold"
										>{useSecondaryForUnlink
											? selectedSecondaryForUnlink
											: authMethods.primaryEmail}</span
									>.
								</p>

								<div
									class="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 text-xs leading-normal"
								>
									{unlinkOtpSuccess}
								</div>

								<div class="flex gap-2">
									<input
										type="text"
										inputmode="numeric"
										maxlength="6"
										pattern="\d{6}"
										placeholder="Enter 6-digit code"
										bind:value={unlinkOtpCode}
										oninput={(e) => {
											unlinkOtpCode = e.currentTarget.value.replace(/\D/g, '');
										}}
										class="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-zinc-650 focus:border-violet-500 focus:outline-none transition-all"
									/>
									<Button
										disabled={unlinkOtpSending}
										onclick={sendUnlinkEmailOtp}
										variant="outline"
										class="rounded-xl border-zinc-800 text-zinc-400 hover:bg-zinc-900 font-bold text-xs h-10 px-4 cursor-pointer"
									>
										{#if unlinkOtpSending}
											Sending...
										{:else}
											Resend
										{/if}
									</Button>
								</div>
							{/if}
						{/if}

						{#if unlinkOtpError}
							<p class="text-xs text-red-400 font-semibold">{unlinkOtpError}</p>
						{/if}
					</div>
				{/if}
			</div>

			<div class="flex items-center justify-end gap-3 pt-2">
				<Button
					variant="outline"
					onclick={() => (showUnlinkPrimaryModal = false)}
					class="rounded-xl font-bold text-xs border-zinc-800 text-zinc-400 hover:bg-zinc-900 cursor-pointer h-10 px-4"
				>
					Cancel
				</Button>
				<Button
					disabled={unlinkingPrimary ||
						(!authMethods?.primaryEmail?.endsWith('@anon.gacha-tracker.app') &&
							unlinkOtpCode.length !== 6) ||
						(useSecondaryForUnlink && eligibleSecondaries.length === 0)}
					onclick={confirmUnlinkPrimary}
					class="bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl h-10 px-5 cursor-pointer gap-2"
				>
					{#if unlinkingPrimary}
						<LoaderCircle class="h-4 w-4 animate-spin" />
						Unlinking...
					{:else}
						Confirm & Unlink
					{/if}
				</Button>
			</div>
		</div>
	</div>
{/if}

{#if showSensitiveActionModal}
	<div
		transition:fade={{ duration: 150 }}
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
	>
		<div
			transition:scale={{ start: 0.95, duration: 150 }}
			class="w-full max-w-md bg-zinc-950/90 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-2xl p-6 space-y-6"
		>
			<div class="flex items-center gap-3 border-b border-zinc-900 pb-4">
				<div
					class="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400"
				>
					<ShieldCheck class="w-5 h-5" />
				</div>
				<div>
					<h3 class="text-lg font-bold text-white">
						{#if sensitiveActionType === 'delete-game'}
							Purge Game Data
						{:else if sensitiveActionType === 'delete-profile'}
							Purge Profile Data
						{:else if sensitiveActionType === 'unlink-secondary-email'}
							Remove Secondary Email
						{:else if sensitiveActionType === 'unlink-social'}
							Unlink Social Provider
						{:else}
							Security Verification
						{/if}
					</h3>
					<p class="text-xs text-zinc-550 mt-0.5">Authorization required</p>
				</div>
			</div>

			<div class="space-y-4">
				<p class="text-sm text-zinc-300 leading-relaxed">
					{#if sensitiveActionType === 'delete-game'}
						To permanently erase all pull histories for <span class="text-white font-semibold"
							>{sensitiveActionTargetName}</span
						>, please verify your identity.
					{:else if sensitiveActionType === 'delete-profile'}
						To permanently erase all pull histories for profile <span
							class="text-white font-semibold">{sensitiveActionTargetName}</span
						>, please verify your identity.
					{:else if sensitiveActionType === 'unlink-secondary-email'}
						To remove and unlink the secondary email <span class="text-white font-semibold"
							>{sensitiveActionTargetName}</span
						> from your account, please verify your identity.
					{:else if sensitiveActionType === 'unlink-social'}
						To disconnect and unlink the social provider <span
							class="text-white font-semibold capitalize">{sensitiveActionTargetName}</span
						> from your account, please verify your identity.
					{:else}
						Please verify your identity to perform this sensitive action.
					{/if}
				</p>

				{#if authMethods?.primaryEmail?.endsWith('@anon.gacha-tracker.app')}
					<div class="space-y-2">
						<label
							for="sensitive-anon-code"
							class="text-xs font-bold text-zinc-400 uppercase tracking-wider block"
						>
							Anonymous Account Code
						</label>
						<input
							type="text"
							id="sensitive-anon-code"
							placeholder="Enter 16-character code"
							bind:value={sensitiveActionCode}
							class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-zinc-650 focus:border-violet-500 focus:outline-none transition-all"
						/>
					</div>
				{:else if !sensitiveActionSuccess}
					<p class="text-sm text-zinc-350 leading-relaxed">
						A 6-digit security code will be sent to your primary email <span
							class="font-mono text-white font-semibold">{authMethods?.primaryEmail}</span
						> to authorize this change.
					</p>
					<Button
						disabled={sensitiveActionSending}
						onclick={sendSensitiveActionOtp}
						class="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl h-10 cursor-pointer gap-2"
					>
						{#if sensitiveActionSending}
							<LoaderCircle class="h-4 w-4 animate-spin text-white" />
							Sending...
						{:else}
							Send Verification Code
						{/if}
					</Button>
				{:else}
					<div
						class="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 text-xs leading-normal"
					>
						{sensitiveActionSuccess}
					</div>

					<div class="space-y-2">
						<label
							for="sensitive-otp-code"
							class="text-xs font-bold text-zinc-400 uppercase tracking-wider block"
						>
							Verification Code
						</label>
						<div class="flex gap-2">
							<input
								type="text"
								id="sensitive-otp-code"
								inputmode="numeric"
								maxlength="6"
								pattern="\d{6}"
								placeholder="Enter 6-digit code"
								bind:value={sensitiveActionCode}
								oninput={(e) => {
									sensitiveActionCode = e.currentTarget.value.replace(/\D/g, '');
								}}
								class="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-zinc-650 focus:border-violet-500 focus:outline-none transition-all"
							/>
							<Button
								disabled={sensitiveActionSending}
								onclick={sendSensitiveActionOtp}
								variant="outline"
								class="rounded-xl border-zinc-800 text-zinc-400 hover:bg-zinc-900 font-bold text-xs h-10 px-4 cursor-pointer"
							>
								{#if sensitiveActionSending}
									Sending...
								{:else}
									Resend
								{/if}
							</Button>
						</div>
					</div>
				{/if}

				{#if sensitiveActionError}
					<p class="text-xs text-red-400 font-semibold">{sensitiveActionError}</p>
				{/if}
			</div>

			<div class="flex items-center justify-end gap-3 pt-2 border-t border-zinc-900">
				<Button
					variant="outline"
					onclick={() => (showSensitiveActionModal = false)}
					class="rounded-xl font-bold text-xs border-zinc-800 text-zinc-400 hover:bg-zinc-900 cursor-pointer h-10 px-4"
				>
					Cancel
				</Button>
				<Button
					disabled={sensitiveActionVerifying ||
						(authMethods?.primaryEmail?.endsWith('@anon.gacha-tracker.app')
							? sensitiveActionCode.length !== 16
							: !sensitiveActionSuccess || sensitiveActionCode.length !== 6)}
					onclick={confirmSensitiveAction}
					class="bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl h-10 px-5 cursor-pointer gap-2"
				>
					{#if sensitiveActionVerifying}
						<LoaderCircle class="h-4 w-4 animate-spin" />
						Verifying...
					{:else}
						Confirm & Verify
					{/if}
				</Button>
			</div>
		</div>
	</div>
{/if}
