import { api } from '$lib/api/client';
import { error } from '@sveltejs/kit';
import type { Pull, GameStats, PaginatedResponse, UserGame } from '@gacha-tracker/shared';

export const load = async ({ params, url }) => {
	const gameId = params.game;
	const urlUid = url.searchParams.get('uid') || undefined;

	try {
		const accountsRes = await api.games({ gameId }).accounts.get();
		if (accountsRes.error) {
			console.error('Error fetching game accounts:', accountsRes.error);
		}

		const accounts = (accountsRes.data?.accounts as UserGame[]) || [];
		const primaryAccount = accounts.find((a) => a.isPrimary) || accounts[0];

		// Validate URL UID: must be 'all' or match an existing account UID
		let effectiveUid: string;
		if (urlUid && (urlUid === 'all' || accounts.some((a) => a.gameUid === urlUid))) {
			effectiveUid = urlUid;
		} else {
			effectiveUid = primaryAccount?.gameUid || 'all';
		}

		const [pullsRes, statsRes] = await Promise.all([
			api.pulls.get({
				query: {
					gameId,
					gameUid: effectiveUid,
					page: 1,
					limit: 50,
					includeTotal: true
				}
			}),
			api.stats({ gameId }).get({
				query: {
					gameUid: effectiveUid
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
