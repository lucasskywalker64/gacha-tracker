import { api } from '$lib/api/client';

export const load = async () => {
	// 1. Fetch settings (Elysia will seed defaults if not exists)
	const { data: settings, error: settingsError } = await api.user.settings.get();

	return {
		settings:
			settingsError || !settings
				? {
						theme: 'system',
						pityDisplayMode: 'count_up'
					}
				: settings
	};
};
