import { error } from '@sveltejs/kit';
import { GAME_CONFIGS } from '@gacha-tracker/shared';
import { api } from '$lib/api/client';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const gameId = params.game;
	const gameConfig = GAME_CONFIGS[gameId];
	if (!gameConfig) throw error(404, `Unknown game: ${gameId}`);

	// Fetch a fresh token and cursors on every load
	const res = await api.pulls.import.token.post({ gameId });

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
		token: res.data.token,
		cursors: res.data.latestPullIds ?? null
	};
};
