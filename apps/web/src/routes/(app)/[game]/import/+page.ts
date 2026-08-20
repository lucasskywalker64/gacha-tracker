import { error } from '@sveltejs/kit';
import { GAME_CONFIGS, type UserGame } from '@gacha-tracker/shared';
import { api } from '$lib/api/client';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url }) => {
	const gameId = params.game;
	const gameConfig = GAME_CONFIGS[gameId];
	if (!gameConfig) throw error(404, `Unknown game: ${gameId}`);

	const accountsRes = await api.games({ gameId }).accounts.get();
	const accountsLoadFailed = Boolean(accountsRes.error);
	if (accountsRes.error) {
		console.error('Error fetching game accounts for import:', accountsRes.error);
	}
	const accounts = (accountsRes.data?.accounts as UserGame[]) || [];

	const paramUid = url.searchParams.get('uid');
	let selectedUid: string;

	if (paramUid && (paramUid === 'new' || accounts.some((a) => a.gameUid === paramUid))) {
		selectedUid = paramUid;
	} else {
		const primary = accounts.find((a) => a.isPrimary) || accounts[0];
		selectedUid = primary?.gameUid || 'new';
	}

	// Fetch a fresh token and cursors for the selected profile
	const res = await api.pulls.import.token.post({
		gameId,
		gameUid: selectedUid !== 'new' ? selectedUid : undefined
	});

	if (res.error) {
		const errorValue = res.error.value;
		const errorMessage =
			(typeof errorValue === 'object' && errorValue && 'error' in errorValue
				? (errorValue as { error: string }).error
				: (errorValue as string)) || 'Failed to generate import token';
		throw error(res.status, errorMessage);
	}

	if (!res.data?.success) {
		throw error(500, 'Failed to generate import token');
	}

	return {
		gameId,
		gameConfig,
		accounts,
		accountsLoadFailed,
		selectedUid,
		token: res.data.token,
		cursors: res.data.latestPullIds ?? null
	};
};
