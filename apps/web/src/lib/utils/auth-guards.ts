import { redirect, type Load } from '@sveltejs/kit';

export const createGuard = <T = unknown>(
	condition: (session: T) => boolean,
	redirectTo: string
): Load => {
	return async ({ parent }) => {
		const { session } = await parent();

		if (condition(session)) {
			throw redirect(302, redirectTo);
		}

		return { session };
	};
};
