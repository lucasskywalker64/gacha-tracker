import { api } from '$lib/api/client';
import { error } from '@sveltejs/kit';
import type { Pull, GameStats, PaginatedResponse } from '@gacha-tracker/shared';

export const load = async ({ params }) => {
	const gameId = params.game;

	try {
		const [pullsRes, statsRes] = await Promise.all([
			api.pulls.get({
				query: {
					gameId,
					page: 1,
					limit: 50
				}
			}),
			api.stats({ gameId }).get()
		]);

		if (pullsRes.error) {
			console.error('Error fetching pulls:', pullsRes.error);
			throw error(500, 'Failed to load pulls');
		}

		if (statsRes.error) {
			console.error('Error fetching stats:', statsRes.error);
			// Stats are non-critical, continue with null
		}

		return {
			gameId,
			initialPulls: pullsRes.data as PaginatedResponse<Pull>,
			stats: statsRes.error ? null : (statsRes.data as GameStats | null)
		};
	} catch (e) {
		console.error('Loader error:', e);
		throw error(500, 'An unexpected error occurred while loading game data');
	}
};
