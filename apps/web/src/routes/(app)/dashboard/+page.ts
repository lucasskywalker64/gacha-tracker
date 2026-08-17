import { api } from '$lib/api/client';
import type { GameStats } from '@gacha-tracker/shared';

export const load = async () => {
	// Get all games the user has imported
	const { data: userGames, error: userGamesError } = await api.user.games.get();

	if (userGamesError || !userGames) {
		return {
			userGames: [],
			statsMap: {},
			totalStats: { pulls: 0, fiveStars: 0 }
		};
	}

	// Fetch stats for each unique game in parallel
	const uniqueGameIds = Array.from(new Set(userGames.map((ug) => ug.gameId)));
	const statsPromises = uniqueGameIds.map((gameId) => api.stats({ gameId }).get());
	const statsResults = await Promise.allSettled(statsPromises);

	const statsMap: Record<string, GameStats> = {};
	let totalPulls = 0;
	let totalFiveStars = 0;

	uniqueGameIds.forEach((gameId, i) => {
		const result = statsResults[i];
		if (result.status === 'fulfilled') {
			const data = result.value.data as GameStats | null;
			if (data) {
				statsMap[gameId] = data;
				totalPulls += data.total || 0;
				totalFiveStars += data.fiveStars || 0;
			}
		}
	});

	return {
		userGames,
		statsMap,
		totalStats: {
			pulls: totalPulls,
			fiveStars: totalFiveStars
		}
	};
};
