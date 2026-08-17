import { api } from '$lib/api/client';
import { error } from '@sveltejs/kit';
import type { Pull, GameStats, PaginatedResponse, UserGame } from '@gacha-tracker/shared';

export const load = async ({ params, url }) => {
	const gameId = params.game;
	const selectedUid = url.searchParams.get('uid') || undefined;

	try {
		const [accountsRes, pullsRes, statsRes] = await Promise.all([
			api.games({ gameId }).accounts.get(),
			api.pulls.get({
				query: {
					gameId,
					gameUid: selectedUid,
					page: 1,
					limit: 50
				}
			}),
			api.stats({ gameId }).get({
				query: {
					gameUid: selectedUid
				}
			})
		]);

		if (pullsRes.error) {
			console.error('Error fetching pulls:', pullsRes.error);
			throw error(500, 'Failed to load pulls');
		}

		if (statsRes.error) {
			console.error('Error fetching stats:', statsRes.error);
			// Stats are non-critical, continue with null
		}

		const accounts = (accountsRes.data?.accounts as UserGame[]) || [];
		const primaryAccount = accounts.find((a) => a.isPrimary) || accounts[0];
		const effectiveUid = selectedUid || primaryAccount?.gameUid || 'all';

		return {
			gameId,
			accounts,
			selectedUid: effectiveUid,
			initialPulls: pullsRes.data as PaginatedResponse<Pull>,
			stats: statsRes.error ? null : (statsRes.data as GameStats | null)
		};
	} catch (e) {
		console.error('Loader error:', e);
		throw error(500, 'An unexpected error occurred while loading game data');
	}
};
