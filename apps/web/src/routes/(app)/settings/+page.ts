import { api } from '$lib/api/client';

export const load = async () => {
	// 1. Fetch settings (Elysia will seed defaults if not exists)
	const { data: settings, error: settingsError } = await api.user.settings.get();

	// 2. Fetch imported games
	const { data: userGames } = await api.user.games.get();

	return {
		settings: settings ?? null,
		settingsLoaderError: Boolean(settingsError),
		userGames: userGames ?? []
	};
};
